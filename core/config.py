import os

# Ngăn TensorFlow xung đột với HuggingFace Transformers
os.environ["TRANSFORMERS_NO_TF"] = "1"
os.environ["USE_TF"] = "0"

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PROJECT_ROOT = os.path.abspath(os.path.join(BASE_DIR, ".."))

class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "unified-api-secret-key-2026")
    
    # Database Neon PostgreSQL
    DB_NAME = os.environ.get("DB_NAME", "VanBan")
    DB_USER = os.environ.get("DB_USER", "VanBan_owner")
    DB_PASS = os.environ.get("DB_PASS", "I8Qjk7txvbou")
    DB_PASSWORD = DB_PASS
    DB_HOST = os.environ.get("DB_HOST", "ep-solitary-surf-a1x7p6aa.ap-southeast-1.aws.neon.tech")
    DB_PORT = os.environ.get("DB_PORT", "5432")
    
    # API Keys
    OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
    
    # Services URLs
    OLLAMA_REMOTE_URL = os.environ.get("OLLAMA_REMOTE_URL", "http://chatbot.tail36da8e.ts.net:11434")
    OLLAMA_LOCAL_URL = os.environ.get("OLLAMA_LOCAL_URL", "http://localhost:11434")
    CHROMA_REMOTE_URL = os.environ.get("CHROMA_REMOTE_URL", "https://chatbot.tail36da8e.ts.net:10000/chromadb")
    CHROMA_SERVER_URL = CHROMA_REMOTE_URL
    
    # Storage Paths
    UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")
    DATA_DIR = os.path.join(BASE_DIR, "data")
    CHROMA_LOCAL_PATH = os.path.join(DATA_DIR, "chroma_db")
    CHROMA_PERSIST_DIR = CHROMA_LOCAL_PATH
    DOCUMENTS_METADATA_FILE = os.path.join(DATA_DIR, "documents.json")
    
    # Models Configuration
    RERANKER_MODEL = "BAAI/bge-reranker-v2-m3"
    EMBEDDING_MODEL = "bge-m3"
    YOLO_MODEL_PATH = os.path.join(PROJECT_ROOT, "OCR", "yolov8n.pt")
    
    # Supported LLM models (Chỉ sử dụng các mô hình từ Ollama)
    AVAILABLE_MODELS = [
        {"id": "qwen2.5:14b", "name": "Qwen 2.5 14B (Mặc định - Thông minh, Tiếng Việt chuẩn)", "provider": "ollama", "default": True},
        {"id": "qwen2.5vl:7b", "name": "Qwen 2.5-VL 7B (Hỗ trợ Đa phương thức & Thị giác Multimodal)", "provider": "ollama", "multimodal": True},
        {"id": "qwen2.5:32b", "name": "Qwen 2.5 32B (Mô hình lớn, Suy luận chuyên sâu)", "provider": "ollama"},
        {"id": "deepseek-r1:8b", "name": "DeepSeek R1 8B (Suy luận logic & CoT Reasoning)", "provider": "ollama"},
        {"id": "llama3.1:latest", "name": "Llama 3.1 8B (Meta AI)", "provider": "ollama"},
        {"id": "llama3.2:latest", "name": "Llama 3.2 (Gọn nhẹ & Tốc độ cao)", "provider": "ollama"},
        {"id": "glm-4.7-flash:latest", "name": "GLM 4.7 Flash (Tốc độ phản hồi cực nhanh)", "provider": "ollama"},
        {"id": "granite3.2-vision:latest", "name": "IBM Granite 3.2 Vision (Nhận diện hình ảnh)", "provider": "ollama", "multimodal": True},
        {"id": "mistral:latest", "name": "Mistral 7B (Đa dụng)", "provider": "ollama"},
        {"id": "deepseek-coder:6.7b", "name": "DeepSeek Coder 6.7B (Chuyên lập trình)", "provider": "ollama"}
    ]
    
    # RAG Settings
    BM25_TOP_N = 25
    VECTOR_TOP_N = 25
    RERANKER_THRESHOLD = 0.30
    RERANKER_TOP_K = 5
    
    # Poppler path nếu có
    POPPLER_PATH = r"C:\Users\admin\Downloads\Release-26.09.0-0\poppler-26.09.0\Library\bin"
