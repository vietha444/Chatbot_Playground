# -*- coding: utf-8 -*-
"""
HPU2 Backend API Server (Standalone REST & SSE Streaming API)
Tích hợp toàn diện các thuật toán từ flask_server_reranker_multimodal.py:
- Hỗ trợ chọn 1 hoặc NHIỀU tài liệu/collections đồng thời (cú pháp mảng hoặc dấu '+')
- Hybrid Search (Vector Chroma + BM25 Neon DB)
- BGE-Reranker-v2-m3 với trích xuất điểm chính xác
- Chroma Multimodal Query (ảnh từ M3Test kèm Base64)
- Ghi log tự động vào bảng raghistory (Neon DB)
- Hệ thống Phân Quyền (Admin / User) kết nối bảng `userid` trên Neon DB
- Tải lên tài liệu người dùng, trích xuất text, RecursiveCharacterTextSplitter, nạp ChromaDB và Neon DB
- Quản trị viên quản lý toàn bộ tài liệu; Người dùng quản lý tài liệu của riêng họ
"""
import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

# Thiết lập cờ biến môi trường
os.environ["TRANSFORMERS_NO_TF"] = "1"
os.environ["USE_TF"] = "0"
os.environ["PYTHONIOENCODING"] = "utf-8"

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

from flask import Flask, request, Response, jsonify, session, stream_with_context, send_file, make_response, render_template, send_from_directory
try:
    from flask_cors import CORS
except ImportError:
    CORS = None
from werkzeug.utils import secure_filename
import json
import time
import base64
import tempfile
from datetime import datetime

from core.config import Config
from core.auth_service import AuthService
from core.llm_service import LLMService
from core.rag_service import RAGService
from core.ocr_service import OCRService
from core.document_service import DocumentService
from core.chat_history_service import ChatHistoryService
from core.office import OfficeService
from core.roleplay_service import RoleplayService
from core.model_service import ModelService

app = Flask(__name__, static_folder="static", static_url_path="", template_folder="templates")
app.secret_key = Config.SECRET_KEY

# Cấu hình CORS mở rộng cho Cloudflare Pages
if CORS:
    CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=True)

# Khởi tạo các services
auth_service = AuthService()
model_service = ModelService()
llm_service = LLMService()
rag_service = RAGService()
ocr_service = OCRService()
document_service = DocumentService()
chat_history_service = ChatHistoryService()
office_service = OfficeService(base_upload_dir=Config.UPLOAD_FOLDER, llm_service=llm_service)
roleplay_service = RoleplayService()

os.makedirs(Config.UPLOAD_FOLDER, exist_ok=True)
os.makedirs(Config.DATA_DIR, exist_ok=True)


@app.before_request
def handle_options_preflight():
    if request.method == 'OPTIONS':
        res = make_response("", 200)
        origin = request.headers.get('Origin', '*')
        res.headers['Access-Control-Allow-Origin'] = origin
        res.headers['Access-Control-Allow-Credentials'] = 'true'
        res.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization,X-Requested-With,X-User-Name,X-User-Role,Accept,Origin'
        res.headers['Access-Control-Allow-Methods'] = 'GET,PUT,POST,DELETE,OPTIONS'
        return res


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get('Origin', '*')
    response.headers['Access-Control-Allow-Origin'] = origin
    response.headers['Access-Control-Allow-Credentials'] = 'true'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization,X-Requested-With,X-User-Name,X-User-Role,Accept,Origin'
    response.headers['Access-Control-Allow-Methods'] = 'GET,PUT,POST,DELETE,OPTIONS'
    return response


@app.errorhandler(404)
def handle_404(e):
    """Đảm bảo mọi endpoint API trả về JSON thay vì HTML lỗi '<!doctype'"""
    if request.path.startswith('/api/'):
        return jsonify({"success": False, "error": f"Không tìm thấy tài nguyên API: {request.path}"}), 404
    return make_response(jsonify({"error": "Not Found"}), 404)


@app.errorhandler(500)
def handle_500(e):
    """Bắt lỗi máy chủ nội bộ và trả về định dạng JSON hợp lệ"""
    if request.path.startswith('/api/'):
        return jsonify({"success": False, "error": f"Lỗi máy chủ nội bộ: {str(e)}"}), 500
    return make_response(jsonify({"error": "Internal Server Error"}), 500)


# ---------------------- HEALTH & API INFO ----------------------
@app.route('/', methods=['GET'])
def index_or_api_info():
    if request.headers.get('Accept') and 'application/json' in request.headers.get('Accept'):
        return jsonify({
            "service": "AI Playground Unified App",
            "status": "online",
            "version": "2.4.0"
        })
    try:
        return render_template("index.html")
    except Exception:
        return jsonify({"service": "AI Playground Unified App", "status": "online"})


@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy", "timestamp": time.time()})


# ---------------------- AUTH & USER MANAGEMENT ----------------------
@app.route('/api/auth/login', methods=['POST', 'OPTIONS'])
def auth_login():
    if request.method == 'OPTIONS':
        return make_response("", 200)

    data = request.get_json() or {}
    username = data.get("username", "")
    password = data.get("password", "")

    user = auth_service.login(username, password)
    if not user:
        return jsonify({"success": False, "error": "Sai tên đăng nhập hoặc mật khẩu."}), 401

    session['user'] = user
    return jsonify({"success": True, "user": user})


@app.route('/api/auth/register', methods=['POST', 'OPTIONS'])
def auth_register():
    if request.method == 'OPTIONS':
        return make_response("", 200)

    data = request.get_json() or {}
    username = data.get("username", "")
    password = data.get("password", "")

    result = auth_service.register(username, password)
    if not result.get("success"):
        return jsonify(result), 400

    session['user'] = result.get("user")
    return jsonify(result)


@app.route('/api/auth/me', methods=['GET'])
def auth_me():
    req_user = request.headers.get("X-User-Name") or request.args.get("username")
    if req_user:
        role = "admin" if req_user.lower() == "admin" else "user"
        return jsonify({
            "authenticated": True,
            "user": {
                "username": req_user,
                "role": role,
                "is_admin": (role == "admin")
            }
        })

    user = session.get('user')
    if user:
        return jsonify({"authenticated": True, "user": user})

    # Mặc định khách vãng lai
    return jsonify({"authenticated": False, "user": {"username": "guest", "role": "user", "is_admin": False}})


@app.route('/api/auth/users', methods=['GET'])
def get_all_users():
    req_role = request.headers.get("X-User-Role", "")
    req_user = request.headers.get("X-User-Name", "")
    if req_role != "admin" and (not req_user or req_user.lower() != "admin"):
        return jsonify({"error": "Chỉ Quản trị viên (Admin) mới có quyền truy cập."}), 403

    users = auth_service.list_users()
    return jsonify({"users": users})


# ---------------------- API CONFIG & METADATA ----------------------
@app.route('/api/config', methods=['GET'])
def get_config():
    """Lấy danh sách Models, Collections và các tài liệu trong hệ thống có phân quyền."""
    username = request.args.get("username") or request.headers.get("X-User-Name") or "system"
    role = request.args.get("role") or request.headers.get("X-User-Role") or ("admin" if username.lower() == "admin" else "user")

    try:
        collections = rag_service.get_available_collections(username=username, role=role)
    except Exception as e:
        collections = [{"name": "m3docdep", "source": "Hệ thống", "doc_count": 0, "type": "multimodal", "uploader": "system"}]

    try:
        models = llm_service.get_available_models()
    except Exception:
        models = Config.AVAILABLE_MODELS

    default_model = next((m["id"] for m in models if m.get("default")), "qwen2.5:14b")

    return jsonify({
        "models": models,
        "collections": collections,
        "default_model": default_model,
        "default_mode": "rag_rerank",
        "default_collection": "m3docdep"
    })


@app.route('/api/models', methods=['GET'])
def get_models():
    """Trả về danh sách các mô hình đang hoạt động trên hệ thống (từ Neon DB system_models)."""
    try:
        models = llm_service.get_available_models()
    except Exception:
        models = Config.AVAILABLE_MODELS
    default_model = next((m["id"] for m in models if m.get("default")), "qwen2.5:14b")
    return jsonify({"models": models, "default_model": default_model})


# ---------------------- ADMIN MODEL MANAGEMENT API (NEON DB) ----------------------
def is_admin_authorized(req):
    """Xác thực quyền Admin từ token / header / session / query params."""
    user = req.headers.get("X-User-Name") or req.args.get("username") or session.get("username", "")
    role = req.headers.get("X-User-Role") or req.args.get("role") or session.get("role", "")
    return (role and role.lower() == "admin") or (user and user.lower() == "admin")


@app.route('/api/admin/models', methods=['GET', 'POST', 'OPTIONS'])
def handle_admin_models():
    """Quản lý danh sách mô hình LLM hệ thống (dành cho Admin)."""
    if request.method == 'OPTIONS':
        return make_response("", 200)

    if not is_admin_authorized(request):
        return jsonify({"success": False, "error": "Chỉ Quản trị viên (Admin) mới có quyền quản lý mô hình hệ thống."}), 403

    if request.method == 'GET':
        models = model_service.get_models()
        default_model = next((m["id"] for m in models if m.get("default")), "qwen2.5:14b")
        return jsonify({
            "success": True,
            "models": models,
            "total": len(models),
            "default_model": default_model
        })

    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        req_user = request.headers.get("X-User-Name") or request.args.get("username") or "admin"
        res = model_service.add_model(data, requested_by=req_user)
        return jsonify(res), (200 if res.get("success") else 400)


@app.route('/api/admin/models/<path:model_id>', methods=['DELETE', 'OPTIONS'])
def handle_admin_delete_model(model_id):
    """Xóa mô hình khỏi hệ thống (Admin only)."""
    if request.method == 'OPTIONS':
        return make_response("", 200)

    if not is_admin_authorized(request):
        return jsonify({"success": False, "error": "Chỉ Quản trị viên (Admin) mới có quyền xóa mô hình."}), 403

    req_user = request.headers.get("X-User-Name") or request.args.get("username") or "admin"
    res = model_service.delete_model(model_id, requested_by=req_user)
    return jsonify(res), (200 if res.get("success") else 400)


@app.route('/api/admin/models/set-default', methods=['POST', 'OPTIONS'])
def handle_admin_set_default_model():
    """Đặt mô hình mặc định trên toàn hệ thống."""
    if request.method == 'OPTIONS':
        return make_response("", 200)

    if not is_admin_authorized(request):
        return jsonify({"success": False, "error": "Chỉ Quản trị viên (Admin) mới có quyền thao tác."}), 403

    data = request.get_json(silent=True) or {}
    model_id = data.get("id") or data.get("model_id")
    req_user = request.headers.get("X-User-Name") or request.args.get("username") or "admin"
    res = model_service.set_default_model(model_id, requested_by=req_user)
    return jsonify(res), (200 if res.get("success") else 400)


@app.route('/api/admin/models/ollama-scan', methods=['GET', 'OPTIONS'])
def handle_admin_ollama_scan():
    """Quét các model đã tải trên Ollama server để đối chiếu."""
    if request.method == 'OPTIONS':
        return make_response("", 200)

    if not is_admin_authorized(request):
        return jsonify({"success": False, "error": "Chỉ Quản trị viên (Admin) mới có quyền truy cập."}), 403

    res = model_service.scan_ollama_models()
    return jsonify(res)



# ---------------------- CHAT SESSIONS & HISTORY API ----------------------
@app.route('/api/chat/sessions', methods=['GET', 'POST', 'OPTIONS'])
def handle_chat_sessions():
    """Lấy danh sách hoặc tạo mới phiên hội thoại trên Neon DB."""
    if request.method == 'OPTIONS':
        return make_response("", 200)

    if request.method == 'GET':
        username = request.args.get("username") or request.headers.get("X-User-Name") or "user"
        role = request.args.get("role") or request.headers.get("X-User-Role") or ("admin" if username.lower() == "admin" else "user")
        sessions = chat_history_service.list_sessions(username=username, role=role)
        return jsonify({"sessions": sessions})

    # POST: Tạo mới phiên chat
    data = request.get_json(silent=True) or {}
    username = data.get("username") or request.form.get("username") or request.args.get("username") or request.headers.get("X-User-Name") or "user"
    title = data.get("title") or request.form.get("title") or request.args.get("title") or "Đoạn hội thoại mới"
    chat_type = data.get("chat_type") or request.form.get("chat_type") or "rag_rerank"
    model = data.get("model") or request.form.get("model") or "qwen2.5:14b"
    if "gemini" in model.lower() or "gpt" in model.lower():
        model = "qwen2.5:14b"
    collections = data.get("collections") or request.form.get("collections") or ""
    session_id = data.get("session_id") or request.form.get("session_id") or f"sess_{int(time.time())}_{os.urandom(3).hex()}"

    sess = chat_history_service.create_or_update_session(
        session_id=session_id,
        username=username,
        title=title,
        chat_type=chat_type,
        model=model,
        collections=collections
    )
    return jsonify({"success": True, "session": sess})


@app.route('/api/chat/sessions/<session_id>', methods=['DELETE', 'OPTIONS'])
def delete_chat_session(session_id):
    """Xóa phiên hội thoại khỏi Neon DB."""
    if request.method == 'OPTIONS':
        return make_response("", 200)

    username = request.args.get("username") or request.headers.get("X-User-Name") or "user"
    role = request.args.get("role") or request.headers.get("X-User-Role") or ("admin" if username.lower() == "admin" else "user")

    success, msg = chat_history_service.delete_session(session_id=session_id, username=username, role=role)
    if not success:
        return jsonify({"success": False, "error": msg}), 403
    return jsonify({"success": True, "message": msg})


@app.route('/api/chat/sessions/<session_id>/rename', methods=['POST', 'PUT', 'OPTIONS'])
def rename_chat_session(session_id):
    """Đổi tên tùy chỉnh cho phiên hội thoại trên Neon DB."""
    if request.method == 'OPTIONS':
        return make_response("", 200)

    data = request.get_json(silent=True) or {}
    new_title = (data.get("title") or request.form.get("title") or request.args.get("title") or "").strip()
    username = request.args.get("username") or data.get("username") or request.form.get("username") or request.headers.get("X-User-Name") or "user"
    role = request.args.get("role") or data.get("role") or request.form.get("role") or request.headers.get("X-User-Role") or ("admin" if username.lower() == "admin" else "user")

    if not new_title:
        return jsonify({"success": False, "error": "Tiêu đề không được để trống."}), 400

    success, result = chat_history_service.rename_session(session_id=session_id, new_title=new_title, username=username, role=role)
    if not success:
        return jsonify({"success": False, "error": result}), 403

    return jsonify({"success": True, "title": result, "message": "Đã đổi tên hội thoại thành công."})


@app.route('/api/chat/sessions/<session_id>/messages', methods=['GET'])
def get_chat_session_messages(session_id):
    """Lấy danh sách tin nhắn của 1 phiên trò chuyện từ Neon DB."""
    username = request.args.get("username") or request.headers.get("X-User-Name") or "user"
    role = request.args.get("role") or request.headers.get("X-User-Role") or ("admin" if username.lower() == "admin" else "user")

    messages = chat_history_service.get_session_messages(session_id=session_id, username=username, role=role)
    return jsonify({"session_id": session_id, "messages": messages})


def format_file_size(num_bytes: int) -> str:
    """Định dạng kích thước file sang B, KB, MB chuẩn."""
    if num_bytes < 1024:
        return f"{num_bytes} B"
    elif num_bytes < 1024 * 1024:
        return f"{num_bytes / 1024:.1f} KB"
    else:
        return f"{num_bytes / (1024 * 1024):.1f} MB"


@app.route('/api/chat/parse-file', methods=['POST', 'OPTIONS'])
def parse_chat_file():
    """Bóc tách nội dung tệp văn bản / tài liệu / code / hình ảnh người dùng đính kèm vào khung chat."""
    if request.method == 'OPTIONS':
        return make_response("", 200)

    if 'file' not in request.files:
        return jsonify({"success": False, "error": "Vui lòng chọn tệp đính kèm."}), 400

    file_obj = request.files['file']
    filename = secure_filename(file_obj.filename or "tep_dinh_kem")
    if not filename:
        filename = "tep_dinh_kem"

    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ""
    file_bytes = file_obj.read()
    file_size = len(file_bytes)
    size_str = format_file_size(file_size)

    # 1. Nếu là hình ảnh: đọc Base64 phục vụ vision multimodal
    image_exts = {'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'}
    is_image = ext in image_exts or (file_obj.mimetype and file_obj.mimetype.startswith("image/"))
    if is_image:
        b64 = base64.b64encode(file_bytes).decode('utf-8')
        return jsonify({
            "success": True,
            "filename": filename,
            "file_type": ext or "image",
            "size": file_size,
            "size_str": size_str,
            "is_image": True,
            "base64": b64,
            "text": "",
            "pages": 1
        })

    # 2. Nếu là tài liệu (PDF, Word, Excel, PPTX, Text, Code...)
    temp_suffix = f".{ext}" if ext else ".txt"
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=temp_suffix) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name

        extracted_text, total_pages = document_service.extract_text_from_file(tmp_path)
        try:
            os.remove(tmp_path)
        except Exception:
            pass

        if not extracted_text or not extracted_text.strip():
            return jsonify({
                "success": False,
                "error": f"Không thể trích xuất văn bản từ tệp '{filename}' hoặc tệp không có nội dung văn bản."
            }), 400

        # Cắt giới hạn ký tự hợp lý để vừa vặn context window của mô hình Ollama
        truncated_text = extracted_text[:120000]
        preview_text = extracted_text[:250].replace("\n", " ").strip()

        return jsonify({
            "success": True,
            "filename": filename,
            "file_type": ext,
            "size": file_size,
            "size_str": size_str,
            "pages": total_pages,
            "is_image": False,
            "text": truncated_text,
            "char_count": len(extracted_text),
            "preview": preview_text
        })
    except Exception as e:
        return jsonify({"success": False, "error": f"Lỗi đọc tệp: {str(e)}"}), 500


# ---------------------- CHAT API (STREAMING SSE) ----------------------
@app.route('/api/chat', methods=['POST', 'OPTIONS'])
def chat():
    if request.method == 'OPTIONS':
        return make_response("", 200)

    data = request.get_json(silent=True) or {}
    user_message = data.get("message", "").strip()
    model_id = data.get("model", "qwen2.5:14b")
    if not model_id or "gemini" in model_id.lower() or "gpt" in model_id.lower():
        model_id = "qwen2.5:14b"
    mode = data.get("mode", "rag_rerank")  # "direct", "hybrid", "rag_rerank"
    current_user = request.headers.get("X-User-Name") or data.get("username") or "CloudflareUser"

    # Phiên làm việc (Session ID)
    session_id = data.get("session_id") or f"sess_{int(time.time())}_{os.urandom(3).hex()}"

    # Hỗ trợ nhận cả dạng mảng 'collections' hoặc chuỗi 'collection' (nối nhau bằng '+')
    raw_collections = data.get("collections") or data.get("collection") or "m3docdep"
    if isinstance(raw_collections, list):
        collection_names = raw_collections
        colname_str = "+".join(raw_collections)
    else:
        colname_str = str(raw_collections).strip()
        collection_names = [c.strip() for c in colname_str.split("+") if c.strip()]

    score_threshold = float(data.get("score_threshold", Config.RERANKER_THRESHOLD))
    client_history = data.get("history", [])

    # Tùy chỉnh thông số AI chuyên sâu (LLM Parameters & System Prompt)
    custom_options = data.get("options") or data.get("custom_options") or {}
    system_prompt = data.get("system_prompt")

    # Hỗ trợ tệp đính kèm trực tiếp (Word, Excel, PDF, PPTX, Text, Code...)
    attached_files = data.get("attached_files") or []
    if isinstance(attached_files, dict):
        attached_files = [attached_files]
    elif not isinstance(attached_files, list):
        attached_files = []

    clean_attached_files_meta = []
    file_prompt_blocks = []

    # Hỗ trợ ảnh đính kèm từ người dùng (Multimodal query)
    user_images = data.get("user_images") or data.get("images") or []
    if isinstance(user_images, str):
        user_images = [user_images]
    elif not isinstance(user_images, list):
        user_images = []

    clean_user_images = []
    for u_img in user_images:
        if isinstance(u_img, dict) and "base64" in u_img:
            clean_user_images.append(u_img["base64"])
        elif isinstance(u_img, str) and u_img.strip():
            clean_user_images.append(u_img.strip())

    for f_item in attached_files:
        if not isinstance(f_item, dict):
            continue
        fname = f_item.get("filename") or f_item.get("name") or "Tệp đính kèm"
        ftype = f_item.get("file_type") or f_item.get("ext") or ""
        fsize = f_item.get("size_str") or ""
        fpages = f_item.get("pages")
        ftext = f_item.get("text") or f_item.get("content") or ""
        is_img = f_item.get("is_image", False)
        b64 = f_item.get("base64")

        # Thu thập metadata để lưu trữ lịch sử
        clean_attached_files_meta.append({
            "filename": fname,
            "file_type": ftype,
            "size_str": fsize,
            "pages": fpages,
            "is_image": is_img
        })

        if is_img and b64:
            clean_user_images.append(b64)
        elif ftext and ftext.strip():
            header = f"[TỆP ĐÍNH KÈM: {fname}"
            if ftype:
                header += f" | Định dạng: {ftype.upper()}"
            if fsize:
                header += f" | Dung lượng: {fsize}"
            if fpages and fpages > 1:
                header += f" | {fpages} trang/sheet"
            header += "]"
            file_prompt_blocks.append(f"{header}\n--- BẮT ĐẦU NỘI DUNG TỆP ---\n{ftext.strip()}\n--- KẾT THÚC NỘI DUNG TỆP ---")

    if not user_message and (file_prompt_blocks or clean_user_images):
        user_message = "Hãy đọc và phân tích nội dung các tệp/hình ảnh tôi vừa gửi đính kèm."
    elif not user_message:
        return jsonify({"error": "Tin nhắn không được để trống"}), 400

    # Lịch sử hội thoại stateless
    if client_history and isinstance(client_history, list):
        active_history = client_history
    else:
        if 'chat_history' not in session:
            session['chat_history'] = []
        active_history = session['chat_history']

    # Lưu/cập nhật phiên hội thoại và tin nhắn User vào Neon DB
    try:
        session_title = data.get("title") or (user_message[:60] + ("..." if len(user_message) > 60 else ""))
        chat_history_service.create_or_update_session(
            session_id=session_id,
            username=current_user,
            title=session_title,
            chat_type=mode,
            model=model_id,
            collections=colname_str
        )
        chat_history_service.save_message(
            session_id=session_id,
            username=current_user,
            role="user",
            content=user_message,
            images=clean_user_images,
            model=model_id,
            attached_files=clean_attached_files_meta
        )
    except Exception as db_init_err:
        print(f"[API Chat] Lỗi ghi nhận session/user message Neon DB: {db_init_err}")

    context_chunks = []
    encoded_images = []
    combined_result_str = ""

    # ========================================================
    # XỬ LÝ RAG ĐA TÀI LIỆU VỚI CÁC THUẬT TOÁN TỪ FILE GỐC
    # ========================================================
    if mode in ["hybrid", "rag_rerank"]:
        print(f"[API Chat] Người dùng '{current_user}' tìm kiếm trên các collections: {collection_names}...")
        
        # Gọi thuật toán tìm kiếm trên 1 hoặc nhiều tài liệu
        context_chunks, encoded_images, combined_result_str = rag_service.retrieve_multi_collections(
            query=user_message,
            collection_names=collection_names,
            score_threshold=score_threshold if mode == "rag_rerank" else 0.0,
            top_k=Config.RERANKER_TOP_K
        )
        print(f"[API Chat] Kết quả RAG: {len(context_chunks)} chunks, {len(encoded_images)} ảnh multimodal.")

    # Xây dựng prompt RAG chuẩn
    if context_chunks:
        final_prompt = llm_service.build_rag_prompt(user_message, context_chunks)
    else:
        final_prompt = user_message

    # Ghép thêm nội dung tệp đính kèm vào context nếu có
    if file_prompt_blocks:
        file_context_str = "DƯỚI ĐÂY LÀ NỘI DUNG CÁC TỆP ĐƯỢC NGƯỜI DÙNG TẢI LÊN ĐÍNH KÈM VÀO TIN NHẮN NÀY:\n" + "\n\n".join(file_prompt_blocks)
        if context_chunks:
            final_prompt = f"{file_context_str}\n\n---\n{final_prompt}"
        else:
            final_prompt = f"{file_context_str}\n\n---\nYÊU CẦU CỦA NGƯỜI DÙNG: {user_message}"

    current_messages = active_history + [{"role": "user", "content": final_prompt}]
    
    # Kết hợp toàn bộ ảnh người dùng tải lên và ảnh trích xuất từ RAG
    all_query_images = clean_user_images + encoded_images

    stream_headers = {
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
        'Connection': 'keep-alive',
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
    }

    @stream_with_context
    def generate():
        # 1. Gửi metadata citations trước
        if context_chunks:
            yield f"data: {json.dumps({'type': 'citations', 'citations': context_chunks}, ensure_ascii=False)}\n\n"

        # 2. Gửi ảnh multimodal đính kèm (nếu tìm thấy từ M3Test Chroma)
        formatted_images = []
        if encoded_images:
            for i, img_b64 in enumerate(encoded_images):
                clean_b64 = img_b64.split(",", 1)[1] if "," in img_b64 else img_b64
                formatted_images.append({
                    "base64": clean_b64,
                    "url": f"data:image/jpeg;base64,{clean_b64}",
                    "filename": f"Tài liệu minh họa #{i+1}"
                })
            yield f"data: {json.dumps({'type': 'images', 'images': formatted_images}, ensure_ascii=False)}\n\n"

        bot_reply = ""
        try:
            # 3. Stream từng token từ LLM (kèm danh sách ảnh Multimodal & Thông số tùy chỉnh)
            for token in llm_service.stream_chat(
                current_messages,
                model_id=model_id,
                images=all_query_images,
                options=custom_options,
                system_prompt=system_prompt
            ):
                bot_reply += token
                yield f"data: {json.dumps({'type': 'token', 'content': token}, ensure_ascii=False)}\n\n"
        except Exception as e:
            err_msg = f"\n[Lỗi phản hồi: {str(e)}]"
            bot_reply += err_msg
            yield f"data: {json.dumps({'type': 'token', 'content': err_msg}, ensure_ascii=False)}\n\n"

        # 4. Gửi tín hiệu hoàn tất kèm session_id để frontend đồng bộ
        yield f"data: {json.dumps({'type': 'done', 'session_id': session_id}, ensure_ascii=False)}\n\n"

        # 5. Lưu tin nhắn Assistant vào Neon DB bảng chat_messages
        try:
            chat_history_service.save_message(
                session_id=session_id,
                username=current_user,
                role="assistant",
                content=bot_reply,
                citations=context_chunks,
                images=formatted_images if formatted_images else [],
                model=model_id
            )
        except Exception as db_save_err:
            print(f"[API Chat] Lỗi lưu assistant message vào Neon DB: {db_save_err}")

        # 6. Lưu log vào PostgreSQL Neon DB (bảng raghistory) theo thuật toán gốc
        try:
            rag_service.log_rag_history(
                user_message=user_message,
                username=current_user,
                bot_reply=bot_reply,
                colname=colname_str,
                combined_result_str=combined_result_str
            )
        except Exception:
            pass

    return Response(generate(), headers=stream_headers)


# ---------------------- QUẢN LÝ TÀI LIỆU & TẢI LÊN (ROLE-BASED) ----------------------
@app.route('/api/documents', methods=['GET'])
def list_documents():
    """Liệt kê danh sách tài liệu. Admin xem toàn bộ, User xem của mình + system."""
    username = request.args.get("username") or request.headers.get("X-User-Name") or "system"
    role = request.args.get("role") or request.headers.get("X-User-Role") or ("admin" if username.lower() == "admin" else "user")
    docs = document_service.list_documents(username=username, role=role)
    return jsonify({"documents": docs})


@app.route('/api/documents/upload', methods=['POST', 'OPTIONS'])
def upload_and_index_document():
    """Tải lên tài liệu từ người dùng, bóc tách text, cắt chunk và nạp vào CSDL RAG."""
    if request.method == 'OPTIONS':
        return make_response("", 200)

    if 'file' not in request.files:
        return jsonify({"error": "Vui lòng chọn file tải lên"}), 400

    file_obj = request.files['file']
    if file_obj.filename == '':
        return jsonify({"error": "Tên file rỗng"}), 400

    tenvanban = request.form.get("tenvanban", "").strip()
    tencollection = request.form.get("tencollection", "").strip()
    uploader = request.form.get("uploader") or request.headers.get("X-User-Name") or "user"

    try:
        doc_record = document_service.upload_and_index_document(
            file_obj=file_obj,
            tenvanban=tenvanban,
            tencollection=tencollection,
            uploader=uploader
        )
        return jsonify({
            "success": True,
            "message": f"Tải lên và lập chỉ mục RAG thành công cho '{doc_record['filename']}'!",
            "document": doc_record
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Lỗi tải tài liệu: {str(e)}"}), 500


@app.route('/api/documents/delete', methods=['POST', 'OPTIONS'])
def delete_document_by_name():
    """Xóa tài liệu khỏi appdatabase và ChromaDB với kiểm tra phân quyền."""
    if request.method == 'OPTIONS':
        return make_response("", 200)

    data = request.get_json() or {}
    tenvanban = data.get("tenvanban", "").strip()
    tencollection = data.get("tencollection", "").strip()
    requested_by = data.get("requested_by") or request.headers.get("X-User-Name") or "user"
    role = data.get("role") or request.headers.get("X-User-Role") or ("admin" if requested_by.lower() == "admin" else "user")

    if not tenvanban or not tencollection:
        return jsonify({"error": "Thiếu tên văn bản hoặc tên collection."}), 400

    success, message = document_service.delete_document_by_name(
        tenvanban=tenvanban,
        tencollection=tencollection,
        requested_by=requested_by,
        role=role
    )
    if not success:
        return jsonify({"error": message}), 403

    return jsonify({"success": True, "message": message})


@app.route('/api/documents/content', methods=['GET', 'OPTIONS'])
def get_document_content_query():
    """Lấy nội dung tài liệu qua Query Parameters (?id=...&collection=...&filename=...)."""
    if request.method == 'OPTIONS':
        return make_response("", 200)

    doc_id = request.args.get("id") or request.args.get("doc_id")
    collection = request.args.get("collection")
    filename = request.args.get("filename")

    doc_info = document_service.get_document_content(
        doc_id_or_col=doc_id,
        collection=collection,
        filename=filename
    )
    return jsonify({"success": True, "document": doc_info})


@app.route('/api/documents/<path:doc_id>/content', methods=['GET', 'OPTIONS'])
def get_document_content_api(doc_id):
    """Lấy toàn văn nội dung tài liệu lưu trong Neon DB (cột doc) hoặc file local."""
    if request.method == 'OPTIONS':
        return make_response("", 200)

    collection = request.args.get("collection")
    filename = request.args.get("filename")

    doc_info = document_service.get_document_content(
        doc_id_or_col=doc_id,
        collection=collection,
        filename=filename
    )
    return jsonify({"success": True, "document": doc_info})


@app.route('/api/documents/<path:doc_id>/file', methods=['GET', 'OPTIONS'])
def view_document_file(doc_id):
    """Xem file đính kèm trực tiếp trong Trình xem tài liệu hoặc hiển thị nội dung trang nhã nếu là tài liệu Neon DB."""
    if request.method == 'OPTIONS':
        return make_response("", 200)

    # 1. Thử gửi file vật lý nếu có trên đĩa
    doc = document_service.get_document(doc_id)
    if doc and doc.get("file_path") and os.path.exists(doc.get("file_path")):
        ext = doc["filename"].split('.')[-1].lower()
        mimetype = "application/pdf" if ext == "pdf" else f"image/{ext}"
        response = make_response(send_file(doc["file_path"], mimetype=mimetype))
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Content-Disposition'] = 'inline'
        return response

    # 2. Nếu không có file vật lý (tài liệu được lưu trong Neon DB), trả về trang HTML hiển thị toàn văn
    doc_info = document_service.get_document_content(doc_id)
    if doc_info and doc_info.get("content"):
        content_text = doc_info["content"]
        html_content = f"""<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{doc_info.get('filename', 'Tài liệu')}</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background: #f8fafc;
            color: #0f172a;
            padding: 2rem 1.5rem;
            margin: 0;
            line-height: 1.85;
        }}
        .container {{
            max-width: 860px;
            margin: 0 auto;
            background: #ffffff;
            padding: 2.2rem 2.8rem;
            border-radius: 12px;
            border: 1px solid #e2e8f0;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
        }}
        h1 {{
            font-size: 1.45rem;
            color: #1e293b;
            margin-top: 0;
            margin-bottom: 0.75rem;
            padding-bottom: 0.75rem;
            border-bottom: 2px solid #e2e8f0;
        }}
        .meta-badges {{
            display: flex;
            gap: 0.5rem;
            flex-wrap: wrap;
            margin-bottom: 1.5rem;
            font-size: 0.8rem;
        }}
        .badge {{
            padding: 2px 8px;
            border-radius: 6px;
            background: #f1f5f9;
            border: 1px solid #cbd5e1;
            color: #475569;
        }}
        .badge-col {{
            background: rgba(79, 70, 229, 0.08);
            border-color: rgba(79, 70, 229, 0.25);
            color: #4f46e5;
            font-weight: 600;
        }}
        .content-body {{
            white-space: pre-wrap;
            word-break: break-word;
            font-size: 0.94rem;
            color: #334155;
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>{doc_info.get('filename', 'Tài liệu')}</h1>
        <div class="meta-badges">
            <span class="badge badge-col">📚 Collection: {doc_info.get('collection', '')}</span>
            <span class="badge">👤 Người tải: {doc_info.get('uploader', 'system')}</span>
            <span class="badge">📊 {doc_info.get('char_count', 0):,} ký tự</span>
            <span class="badge">🕒 {doc_info.get('created_at', '')}</span>
        </div>
        <div class="content-body">{content_text}</div>
    </div>
</body>
</html>"""
        response = make_response(html_content)
        response.headers['Content-Type'] = 'text/html; charset=utf-8'
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response

    return jsonify({"error": "File không tồn tại"}), 404


# ---------------------- OCR & DOCUMENT PROCESSING ----------------------
@app.route('/api/ocr/upload', methods=['POST', 'OPTIONS'])
def upload_and_ocr():
    if request.method == 'OPTIONS':
        return make_response("", 200)

    if 'file' not in request.files:
        return jsonify({"error": "Không tìm thấy file tải lên"}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "Tên file rỗng"}), 400

    filename = secure_filename(file.filename)
    timestamp = int(time.time())
    unique_filename = f"{timestamp}_{filename}"
    saved_path = os.path.join(Config.UPLOAD_FOLDER, unique_filename)
    file.save(saved_path)

    two_column = request.form.get('two_column', 'true').lower() == 'true'
    output_format = request.form.get('output_format', 'markdown')
    use_ollama = request.form.get('use_ollama', 'false').lower() == 'true'
    ollama_model = request.form.get('ollama_model', 'qwen2.5:14b')
    try:
        conf_threshold = float(request.form.get('conf_threshold', 0.25))
    except Exception:
        conf_threshold = 0.25
    lang_str = request.form.get('languages', 'vi,en')
    languages = tuple(l.strip() for l in lang_str.split(',') if l.strip()) or ('vi', 'en')
    try:
        dpi = int(request.form.get('dpi', 150))
    except Exception:
        dpi = 150

    print(f"[API OCR] Bóc tách tài liệu: {saved_path} (2-col: {two_column}, Format: {output_format}, AI: {use_ollama})")
    try:
        ocr_result = ocr_service.extract_full_document(
            file_path=saved_path,
            two_column=two_column,
            output_format=output_format,
            use_ollama=use_ollama,
            ollama_model=ollama_model,
            conf_threshold=conf_threshold,
            languages=languages,
            dpi=dpi
        )
        if "error" in ocr_result:
            return jsonify({"error": ocr_result["error"]}), 400

        ocr_result["file_saved_path"] = saved_path
        ocr_result["unique_filename"] = unique_filename
        ocr_result["original_filename"] = filename
        return jsonify(ocr_result)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Lỗi xử lý OCR: {str(e)}"}), 500


@app.route('/api/history/clear', methods=['POST', 'OPTIONS'])
def clear_history():
    if request.method == 'OPTIONS':
        return make_response("", 200)
    session['chat_history'] = []
    return jsonify({"success": True, "message": "Đã làm mới đoạn hội thoại."})


# ---------------------- OFFICE STUDIO AI API ----------------------
@app.route('/api/office/generate', methods=['POST', 'OPTIONS'])
def office_generate():
    """Tạo mới tài liệu Word, Excel hoặc PowerPoint từ Prompt người dùng."""
    if request.method == 'OPTIONS':
        return make_response("", 200)

    data = request.get_json(silent=True) or {}
    doc_type = data.get("doc_type") or request.form.get("doc_type") or "docx"
    prompt = data.get("prompt") or request.form.get("prompt") or ""
    model = data.get("model") or request.form.get("model") or "qwen2.5:14b"
    style = data.get("style") or request.form.get("style") or "standard"

    if not prompt.strip():
        return jsonify({"success": False, "error": "Vui lòng nhập nội dung yêu cầu tạo tài liệu."}), 400

    try:
        res = office_service.generate_document(
            doc_type=doc_type,
            prompt=prompt,
            model_name=model,
            template_style=style
        )
        return jsonify(res)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": f"Lỗi tạo tài liệu Office: {str(e)}"}), 500


@app.route('/api/office/edit', methods=['POST', 'OPTIONS'])
def office_edit():
    """Sửa và tối ưu hóa tài liệu Office người dùng tải lên."""
    if request.method == 'OPTIONS':
        return make_response("", 200)

    if 'file' not in request.files:
        return jsonify({"success": False, "error": "Vui lòng tải lên file tài liệu cần chỉnh sửa."}), 400

    file = request.files['file']
    if not file.filename:
        return jsonify({"success": False, "error": "Tên file không hợp lệ."}), 400

    prompt = request.form.get("prompt") or request.args.get("prompt") or ""
    model = request.form.get("model") or request.args.get("model") or "qwen2.5:14b"

    if not prompt.strip():
        return jsonify({"success": False, "error": "Vui lòng cung cấp hướng dẫn hoặc yêu cầu chỉnh sửa."}), 400

    temp_filename = f"temp_edit_{int(time.time())}_{secure_filename(file.filename)}"
    temp_path = os.path.join(office_service.upload_dir, temp_filename)
    file.save(temp_path)

    try:
        res = office_service.edit_document(
            file_path=temp_path,
            prompt=prompt,
            model_name=model
        )
        return jsonify(res)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": f"Lỗi chỉnh sửa tài liệu: {str(e)}"}), 500
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass


@app.route('/api/office/evaluate', methods=['POST', 'OPTIONS'])
def office_evaluate():
    """Chấm điểm và đối chiếu tài liệu bài nộp với file đáp án mẫu / barem."""
    if request.method == 'OPTIONS':
        return make_response("", 200)

    if 'submission_file' not in request.files:
        return jsonify({"success": False, "error": "Thiếu file bài làm / bài nộp cần đánh giá."}), 400
    if 'answer_key_file' not in request.files:
        return jsonify({"success": False, "error": "Thiếu file đáp án mẫu / barem tiêu chuẩn để đối chiếu."}), 400

    sub_file = request.files['submission_file']
    ans_file = request.files['answer_key_file']
    criteria_notes = request.form.get("criteria_notes") or request.args.get("criteria_notes") or ""
    model = request.form.get("model") or request.args.get("model") or "qwen2.5:14b"

    sub_filename = f"temp_sub_{int(time.time())}_{secure_filename(sub_file.filename)}"
    ans_filename = f"temp_ans_{int(time.time())}_{secure_filename(ans_file.filename)}"
    sub_path = os.path.join(office_service.upload_dir, sub_filename)
    ans_path = os.path.join(office_service.upload_dir, ans_filename)

    sub_file.save(sub_path)
    ans_file.save(ans_path)

    try:
        res = office_service.evaluate_documents(
            submission_path=sub_path,
            answer_key_path=ans_path,
            criteria_notes=criteria_notes,
            model_name=model
        )
        return jsonify(res)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": f"Lỗi đánh giá đối chiếu tài liệu: {str(e)}"}), 500
    finally:
        if os.path.exists(sub_path):
            try:
                os.remove(sub_path)
            except Exception:
                pass
        if os.path.exists(ans_path):
            try:
                os.remove(ans_path)
            except Exception:
                pass


@app.route('/api/office/download/<path:filename>', methods=['GET'])
def office_download(filename):
    """Tải file Office đã tạo hoặc xem trực tiếp (inline)."""
    preview = request.args.get('preview', '0') == '1'
    return send_from_directory(office_service.upload_dir, filename, as_attachment=not preview)


@app.route('/api/office/pptx-data/<path:filename>', methods=['GET'])
def office_pptx_data(filename):
    """Bóc tách dữ liệu slide PPTX để trình chiếu trực tiếp trên Office Online Viewer."""
    fpath = os.path.join(office_service.upload_dir, filename)
    if not os.path.exists(fpath):
        return jsonify({"success": False, "error": "File không tồn tại"}), 404
    try:
        import pptx
        prs = pptx.Presentation(fpath)
        slides_data = []
        for idx, slide in enumerate(prs.slides, 1):
            slide_info = {"slide_number": idx, "title": "", "bullets": [], "tables": []}
            for shape in slide.shapes:
                if shape.has_text_frame:
                    text = shape.text.strip()
                    if not text:
                        continue
                    if shape == slide.shapes[0] and not slide_info["title"]:
                        slide_info["title"] = text
                    else:
                        for p in shape.text_frame.paragraphs:
                            p_txt = p.text.strip()
                            if p_txt:
                                slide_info["bullets"].append(p_txt)
                elif shape.has_table:
                    table_data = []
                    for row in shape.table.rows:
                        row_vals = [cell.text.strip() for cell in row.cells]
                        table_data.append(row_vals)
                    if table_data:
                        slide_info["tables"].append(table_data)
            slides_data.append(slide_info)
        return jsonify({"success": True, "filename": filename, "total_slides": len(slides_data), "slides": slides_data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/office/list', methods=['GET'])
def office_list_files():
    """Lấy danh sách các tài liệu Office đã được tạo trong hệ thống."""
    files_list = []
    if os.path.exists(office_service.upload_dir):
        for f in sorted(os.listdir(office_service.upload_dir), key=lambda x: os.path.getmtime(os.path.join(office_service.upload_dir, x)), reverse=True):
            if f.startswith("temp_"):
                continue
            ext = os.path.splitext(f)[1].lower()
            if ext in [".docx", ".xlsx", ".pptx", ".pdf"]:
                f_path = os.path.join(office_service.upload_dir, f)
                files_list.append({
                    "filename": f,
                    "file_type": ext.replace(".", ""),
                    "size_bytes": os.path.getsize(f_path),
                    "created_at": datetime.fromtimestamp(os.path.getmtime(f_path)).strftime("%Y-%m-%d %H:%M:%S"),
                    "download_url": f"/api/office/download/{f}"
                })
    return jsonify({"success": True, "files": files_list[:30]})


# =====================================================================
# HPU2 AI ROLEPLAY API (NHẬP VAI NHÂN VẬT TỪ NEON DB & OLLAMA STREAMING)
# =====================================================================

@app.route('/api/roleplay/characters', methods=['GET', 'OPTIONS'])
def roleplay_get_characters():
    """Lấy danh sách các nhân vật nhập vai từ bảng roleplay trong Neon DB."""
    if request.method == 'OPTIONS':
        return make_response("", 200)
    try:
        force_refresh = request.args.get("refresh", "false").lower() == "true"
        characters = roleplay_service.get_characters(force_refresh=force_refresh)
        return jsonify({"success": True, "characters": characters, "total": len(characters)})
    except Exception as e:
        return jsonify({"success": False, "error": f"Lỗi tải danh sách nhân vật: {str(e)}"}), 500


@app.route('/api/roleplay/characters/<path:character_name>', methods=['GET', 'OPTIONS'])
def roleplay_get_character(character_name):
    """Lấy thông tin chi tiết một nhân vật nhập vai."""
    if request.method == 'OPTIONS':
        return make_response("", 200)
    try:
        char = roleplay_service.get_character(character_name)
        if not char:
            return jsonify({"success": False, "error": f"Không tìm thấy nhân vật '{character_name}'"}), 404
        return jsonify({"success": True, "character": char})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/roleplay/characters', methods=['POST', 'OPTIONS'])
def roleplay_save_character():
    """Tạo mới hoặc cập nhật thông tin nhân vật vào Neon DB."""
    if request.method == 'OPTIONS':
        return make_response("", 200)
    data = request.get_json(silent=True) or {}
    success, msg = roleplay_service.create_or_update_character(data)
    if not success:
        return jsonify({"success": False, "error": msg}), 400
    return jsonify({"success": True, "message": msg})


@app.route('/api/roleplay/characters/<path:character_name>', methods=['DELETE', 'OPTIONS'])
def roleplay_delete_character(character_name):
    """Xóa nhân vật khỏi bảng roleplay trên Neon DB."""
    if request.method == 'OPTIONS':
        return make_response("", 200)
    success, msg = roleplay_service.delete_character(character_name)
    if not success:
        return jsonify({"success": False, "error": msg}), 400
    return jsonify({"success": True, "message": msg})


@app.route('/api/roleplay/chat', methods=['POST', 'OPTIONS'])
def roleplay_chat():
    """
    Streaming SSE phản hồi nhập vai dựa theo cấu trúc Role_play.dart:
    - Nạp Instruction, Persona, Scenario của nhân vật từ Neon DB
    - Nạp tri thức bổ sung Chroma (nếu có additional_data)
    - Áp dụng các tham số siêu vi: temperature, repeat_penalty, min_p, repeat_last_n
    - Stream token kèm cử chỉ biểu cảm hành động dạng *hành động*
    """
    if request.method == 'OPTIONS':
        return make_response("", 200)

    data = request.get_json(silent=True) or {}
    character_name = data.get("character_name", "").strip()
    user_message = data.get("message", "").strip()
    history = data.get("history", [])
    model_id = data.get("model", "qwen2.5:14b")
    custom_options = data.get("custom_options")
    session_id = data.get("session_id") or f"roleplay_{int(time.time())}_{os.urandom(3).hex()}"
    current_user = request.headers.get("X-User-Name") or data.get("username") or "user"

    if not character_name:
        return jsonify({"success": False, "error": "Vui lòng chọn một nhân vật để trò chuyện."}), 400
    if not user_message:
        return jsonify({"success": False, "error": "Tin nhắn không được để trống."}), 400

    char = roleplay_service.get_character(character_name)
    if not char:
        return jsonify({"success": False, "error": f"Nhân vật '{character_name}' không tồn tại."}), 404

    # Kiểm tra additional_data (Chroma collection) nếu nhân vật có gắn kèm kho tri thức
    additional_knowledge = ""
    add_col = char.get("additional_data")
    if add_col and add_col not in ("None", "null", ""):
        try:
            chunks, _, _ = rag_service.retrieve_multi_collections(
                query=user_message,
                collection_names=[add_col],
                score_threshold=0.20,
                top_k=3
            )
            if chunks:
                additional_knowledge = "\n".join([f"- {c.get('text', '')}" for c in chunks])
        except Exception as rag_err:
            print(f"[Roleplay Chat] Không thể nạp Chroma additional_data '{add_col}': {rag_err}")

    # Ghi nhận phiên hội thoại vào Neon DB (nếu bảng chat_sessions khả dụng)
    try:
        session_title = f"🎭 Nhập vai: {char['character_name']}"
        chat_history_service.create_or_update_session(
            session_id=session_id,
            username=current_user,
            title=session_title,
            chat_type="roleplay",
            model=model_id,
            collections=character_name
        )
        chat_history_service.save_message(
            session_id=session_id,
            username=current_user,
            role="user",
            content=user_message,
            model=model_id
        )
    except Exception as db_err:
        print(f"[Roleplay Chat] Ghi nhận lịch sử ban đầu: {db_err}")

    stream_headers = {
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
        'Connection': 'keep-alive',
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
    }

    @stream_with_context
    def generate():
        # Gửi thông tin nhân vật đang đàm thoại
        meta_event = {
            "type": "character",
            "character": {
                "character_name": char["character_name"],
                "content": char["content"],
                "linkanh": char["linkanh"],
                "temperature": char["temperature"],
                "repeat_penalty": char["repeat_penalty"]
            },
            "session_id": session_id
        }
        yield f"data: {json.dumps(meta_event, ensure_ascii=False)}\n\n"

        ai_reply = ""
        try:
            for token in roleplay_service.stream_roleplay_chat(
                character_name=character_name,
                user_message=user_message,
                history=history,
                model_id=model_id,
                custom_options=custom_options,
                additional_knowledge=additional_knowledge
            ):
                ai_reply += token
                yield f"data: {json.dumps({'type': 'token', 'content': token}, ensure_ascii=False)}\n\n"
        except Exception as err:
            err_msg = f"\n[Lỗi kết nối tới mô hình nhập vai: {str(err)}]"
            ai_reply += err_msg
            yield f"data: {json.dumps({'type': 'token', 'content': err_msg}, ensure_ascii=False)}\n\n"

        # Gửi tín hiệu hoàn tất
        yield f"data: {json.dumps({'type': 'done', 'character_name': character_name, 'session_id': session_id}, ensure_ascii=False)}\n\n"

        # Lưu tin nhắn Assistant vào Neon DB
        try:
            chat_history_service.save_message(
                session_id=session_id,
                username=current_user,
                role="assistant",
                content=ai_reply,
                model=model_id
            )
        except Exception as db_save_err:
            print(f"[Roleplay Chat] Lưu tin nhắn Assistant vào DB: {db_save_err}")

    return Response(generate(), headers=stream_headers)


if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    print(f"\n==================================================================")
    print(f"🚀 HPU2 STANDALONE BACKEND API (v2.2 USER AUTH & DOC MANAGEMENT)")
    print(f"📡 API ĐANG HOẠT ĐỘNG TẠI: http://0.0.0.0:{port}")
    print(f"==================================================================\n")
    app.run(host="0.0.0.0", port=port, debug=False)
