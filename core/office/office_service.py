"""
Dịch vụ Quản lý và Điều phối Tài liệu Văn phòng (Office Service Orchestrator)
Hỗ trợ Tạo mới, Chỉnh sửa và Đánh giá/Chấm điểm tài liệu qua mô hình Ollama Local.
"""
import os
import re
import uuid
import json
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime

from .parsers import extract_any_document
from .docx_builder import build_docx_from_data, build_docx_from_markdown
from .excel_builder import build_excel_from_data, build_excel_from_markdown
from .pptx_builder import build_pptx_from_data, build_pptx_from_markdown
from .evaluator import run_evaluation
from .utils import robust_extract_json, clean_raw_llm_text

logger = logging.getLogger(__name__)

DOCX_SYSTEM_PROMPT = """Bạn là chuyên gia soạn thảo văn bản và tài liệu hành chính, công vụ và doanh nghiệp hàng đầu.
Khi nhận được yêu cầu của người dùng, bạn PHẢI tạo nội dung tài liệu đầy đủ, chuyên nghiệp, chuẩn mực ngôn ngữ tiếng Việt.

BẮT BUỘC TRẢ VỀ DUY NHẤT một khối JSON hợp lệ trong ```json ... ``` theo cấu trúc sau:
{
  "title": "TIÊU ĐỀ CHÍNH CỦA VĂN BẢN (IN HOA)",
  "subtitle": "Tiêu đề phụ hoặc trích yếu nội dung (nếu có)",
  "organization": "TÊN CƠ QUAN / ĐƠN VỊ BAN HÀNH (nếu phù hợp)",
  "sections": [
    {
      "heading": "I. TÊN MỤC CHÍNH",
      "level": 1,
      "type": "paragraphs",
      "content": [
        "Đoạn văn chi tiết 1...",
        "Đoạn văn chi tiết 2..."
      ]
    },
    {
      "heading": "II. TIÊU CHÍ HOẶC DANH SÁCH CHI TIẾT",
      "level": 1,
      "type": "bullets",
      "items": [
        "Ý thứ nhất...",
        "Ý thứ hai..."
      ]
    },
    {
      "heading": "III. BẢNG DỮ LIỆU HOẶC PHÂN CÔNG",
      "level": 1,
      "type": "table",
      "headers": ["STT", "Hạng Mục", "Nội Dung", "Người Phụ Trách", "Ghi Chú"],
      "rows": [
        ["1", "Hạng mục A", "Nội dung triển khai A", "Nguyễn Văn A", "Đúng hạn"],
        ["2", "Hạng mục B", "Nội dung triển khai B", "Trần Thị B", "Ưu tiên"]
      ]
    },
    {
      "type": "callout",
      "text": "Lưu ý quan trọng hoặc quy định bắt buộc phải tuân thủ..."
    }
  ],
  "signatures": [
    {"title": "NGƯỜI LẬP BIỂU", "name": ""},
    {"title": "THỦ TRƯỞNG ĐƠN VỊ", "name": ""}
  ]
}
Không thêm bất kỳ lời chào, giải thích hoặc ký tự nào ngoài khối JSON.
"""

EXCEL_SYSTEM_PROMPT = """Bạn là chuyên gia phân tích dữ liệu và thiết kế bảng tính Microsoft Excel chuyên nghiệp.
Nhiệm vụ của bạn là tạo bảng tính chuẩn mực, có cấu trúc cột rõ ràng, kiểu dữ liệu phù hợp và CÔNG THỨC EXCEL TỰ ĐỘNG CHUẨN XÁC (=SUM, =AVERAGE, =IF, =COUNTIF, =VLOOKUP,...).

BẮT BUỘC TRẢ VỀ DUY NHẤT một khối JSON hợp lệ trong ```json ... ``` theo cấu trúc:
{
  "title": "TÊN BẢNG TÍNH EXCEL",
  "subtitle": "Kỳ báo cáo hoặc mô tả chi tiết",
  "sheets": [
    {
      "sheet_name": "Tên Sheet (ngắn gọn dưới 30 ký tự)",
      "headers": ["STT", "Tên Hàng Hóa / Nhân Viên", "Số Lượng", "Đơn Giá", "Thành Tiền", "Xếp Loại / Ghi Chú"],
      "rows": [
        ["1", "Sản phẩm A", 10, 500000, "=C4*D4", "Đạt chuẩn"],
        ["2", "Sản phẩm B", 25, 200000, "=C5*D5", "Bán chạy"],
        ["3", "Sản phẩm C", 8, 1200000, "=C6*D6", "Cao cấp"]
      ],
      "total_row": ["Tổng cộng", "", "=SUM(C4:C6)", "", "=SUM(E4:E6)", ""],
      "formats": {"C": "number", "D": "currency", "E": "currency"}
    }
  ]
}
Lưu ý:
- Tọa độ dòng dữ liệu bắt đầu từ dòng 4 (dòng 1: Tiêu đề, dòng 2: Phụ đề, dòng 3: Headers). Hãy viết công thức khớp chính xác với số dòng.
- Không thêm bất kỳ lời chào hoặc văn bản nào ngoài khối JSON.
"""

PPTX_SYSTEM_PROMPT = """Bạn là chuyên gia thiết kế bản trình chiếu thuyết trình PowerPoint hiện đại, súc tích và có tính thẩm mỹ cao.
Nhiệm vụ của bạn là thiết kế dàn ý bài thuyết trình gồm các slide được chắt lọc ý chính rõ ràng.

BẮT BUỘC TRẢ VỀ DUY NHẤT một khối JSON hợp lệ trong ```json ... ``` theo cấu trúc:
{
  "title": "TIÊU ĐỀ BÀI THUYẾT TRÌNH",
  "subtitle": "Chủ đề phụ hoặc thông điệp cốt lõi",
  "presenter": "Đơn vị hoặc Chuyên gia thuyết trình",
  "slides": [
    {
      "title": "1. Đặt Vấn Đề & Bối Cảnh",
      "bullets": [
        "Xu hướng chuyển đổi số mạnh mẽ trong giai đoạn hiện nay",
        "Những thách thức về chi phí và tối ưu nguồn nhân lực",
        "Nhu cầu cấp thiết về giải pháp tự động hóa thông minh"
      ],
      "notes": "Nhấn mạnh số liệu thống kê về áp lực cạnh tranh."
    },
    {
      "title": "2. Bảng Phân Tích Giải Pháp",
      "table": {
        "headers": ["Tiêu Chí", "Mô Hình Cũ", "Giải Pháp Mới"],
        "rows": [
          ["Chi phí", "Rất cao", "Tiết kiệm 60%"],
          ["Thời gian", "3 - 5 ngày", "Tức thì (vài giây)"]
        ]
      },
      "notes": "Nêu bật con số tiết kiệm 60%."
    },
    {
      "title": "3. Kế Hoạch Triển Khai",
      "bullets": [
        "Giai đoạn 1: Chuẩn bị hạ tầng và kiểm thử sơ bộ",
        "Giai đoạn 2: Tích hợp hệ thống và đào tạo người dùng",
        "Giai đoạn 3: Đánh giá hiệu năng và nghiệm thu"
      ],
      "notes": "Trình bày rõ lộ trình từng tuần."
    }
  ]
}
Không thêm bất kỳ lời chào hoặc văn bản nào ngoài khối JSON.
"""

EDIT_SYSTEM_PROMPT = """Bạn là chuyên gia hiệu đính, chỉnh sửa và tối ưu hóa tài liệu văn phòng (Word, Excel, PowerPoint).
Nhiệm vụ của bạn là đọc kỹ nội dung tài liệu hiện tại, thực hiện chính xác các yêu cầu chỉnh sửa/sửa lỗi/bổ sung của người dùng, và xuất ra bản tài liệu hoàn chỉnh mới cùng bản tóm tắt các điểm đã sửa.

BẮT BUỘC TRẢ VỀ DUY NHẤT một khối JSON hợp lệ trong ```json ... ```:
{
  "changelog": [
    "Đã sửa các lỗi chính tả và chuẩn hóa câu chữ...",
    "Đã bổ sung mục điều khoản bảo mật theo yêu cầu...",
    "Đã điều chỉnh công thức tính toán..."
  ],
  "edited_title": "Tiêu đề tài liệu sau khi chỉnh sửa",
  "markdown_content": "Toàn bộ nội dung tài liệu đầy đủ đã được chỉnh sửa trình bày bằng Markdown chuẩn..."
}
"""

class OfficeService:
    def __init__(self, base_upload_dir: str, llm_service: Any):
        self.upload_dir = os.path.join(base_upload_dir, "office_files")
        os.makedirs(self.upload_dir, exist_ok=True)
        self.llm_service = llm_service
        logger.info(f"OfficeService khởi tạo thành công tại: {self.upload_dir}")

    def generate_document(
        self,
        doc_type: str,
        prompt: str,
        model_name: str = "qwen2.5:14b",
        template_style: str = "standard"
    ) -> Dict[str, Any]:
        """Tạo mới tài liệu Word, Excel hoặc PowerPoint từ Prompt người dùng"""
        doc_type = doc_type.lower().strip()
        if doc_type not in ["docx", "xlsx", "pptx", "word", "excel", "powerpoint"]:
            raise ValueError(f"Định dạng tài liệu không được hỗ trợ: {doc_type}")
            
        file_id = str(uuid.uuid4())[:8]
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Chọn System Prompt phù hợp
        if doc_type in ["docx", "word"]:
            norm_type = "docx"
            system_prompt = DOCX_SYSTEM_PROMPT
            filename = f"TaiLieu_{timestamp}_{file_id}.docx"
        elif doc_type in ["xlsx", "excel"]:
            norm_type = "xlsx"
            system_prompt = EXCEL_SYSTEM_PROMPT
            filename = f"BangTinh_{timestamp}_{file_id}.xlsx"
        else:
            norm_type = "pptx"
            system_prompt = PPTX_SYSTEM_PROMPT
            filename = f"ThuyetTrinh_{timestamp}_{file_id}.pptx"
            
        output_path = os.path.join(self.upload_dir, filename)
        
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"YÊU CẦU SOẠN THẢO TÀI LIỆU:\n{prompt}\nPhong cách: {template_style}"}
        ]
        
        logger.info(f"Đang tạo tài liệu {norm_type} với model {model_name}...")
        raw_response = ""
        for chunk in self.llm_service.stream_chat(messages, model=model_name):
            raw_response += chunk
            
        # Thử parse JSON với bộ phục hồi lỗi cú pháp thông minh
        parsed_data = robust_extract_json(raw_response)
        
        # Xây dựng file thực tế
        if norm_type == "docx":
            if parsed_data and isinstance(parsed_data, dict) and ("sections" in parsed_data or "title" in parsed_data):
                build_docx_from_data(parsed_data, output_path)
            else:
                cleaned_md = clean_raw_llm_text(raw_response)
                build_docx_from_markdown(cleaned_md or raw_response, output_path, title="TÀI LIỆU VĂN BẢN")
        elif norm_type == "xlsx":
            if parsed_data and isinstance(parsed_data, dict) and ("sheets" in parsed_data or "headers" in parsed_data):
                build_excel_from_data(parsed_data, output_path)
            else:
                cleaned_md = clean_raw_llm_text(raw_response)
                build_excel_from_markdown(cleaned_md or raw_response, output_path, title="BẢNG DỮ LIỆU EXCEL")
        else: # pptx
            if parsed_data and isinstance(parsed_data, dict) and "slides" in parsed_data:
                build_pptx_from_data(parsed_data, output_path)
            else:
                cleaned_md = clean_raw_llm_text(raw_response)
                build_pptx_from_markdown(cleaned_md or raw_response, output_path, title="BÀI THUYẾT TRÌNH")
                
        file_size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
        
        return {
            "success": True,
            "file_id": file_id,
            "filename": filename,
            "file_type": norm_type,
            "file_size": file_size,
            "file_path": output_path,
            "download_url": f"/api/office/download/{filename}",
            "parsed_structure": parsed_data,
            "raw_text": raw_response[:1000] # preview ngắn gọn
        }

    def edit_document(
        self,
        file_path: str,
        prompt: str,
        model_name: str = "qwen2.5:14b"
    ) -> Dict[str, Any]:
        """Đọc và chỉnh sửa tài liệu Office theo yêu cầu người dùng"""
        if not os.path.isfile(file_path):
            raise FileNotFoundError(f"Không tìm thấy file: {file_path}")
            
        doc_info = extract_any_document(file_path)
        ext = os.path.splitext(file_path)[1].lower()
        orig_name = re.sub(r'^temp_[a-zA-Z0-9]+_\d+_', '', os.path.basename(file_path))
        
        file_id = str(uuid.uuid4())[:8]
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_name = os.path.splitext(orig_name)[0]
        out_filename = f"{safe_name}_da_sua_{timestamp}_{file_id}{ext if ext in ['.docx', '.xlsx', '.pptx'] else '.docx'}"
        output_path = os.path.join(self.upload_dir, out_filename)
        
        doc_text = doc_info.get("full_text", "")
        if len(doc_text) > 30000:
            doc_text = doc_text[:30000] + "\n...[Nội dung đã được tóm lược bớt]..."

        messages = [
            {"role": "system", "content": EDIT_SYSTEM_PROMPT},
            {
                "role": "user", 
                "content": f"TÊN TÀI LIỆU GỐC: {orig_name}\n"
                           f"NỘI DUNG HIỆN TẠI CỦA TÀI LIỆU:\n{doc_text}\n\n"
                           f"YÊU CẦU CHỈNH SỬA / NÂNG CẤP TỪ NGƯỜI DÙNG:\n{prompt}"
            }
        ]
        
        logger.info(f"Đang chỉnh sửa file '{orig_name}' bằng mô hình {model_name}...")
        raw_response = ""
        for chunk in self.llm_service.stream_chat(messages, model=model_name):
            raw_response += chunk
            
        parsed_edit = _extract_json_from_text(raw_response)
        changelog = []
        md_content = raw_response
        edit_title = orig_name
        
        if parsed_edit and isinstance(parsed_edit, dict):
            changelog = parsed_edit.get("changelog", [])
            md_content = parsed_edit.get("markdown_content", raw_response)
            edit_title = parsed_edit.get("edited_title", orig_name)

        # Tạo file đầu ra theo định dạng
        if ext in [".xlsx", ".xls"]:
            build_excel_from_markdown(md_content, output_path, title=edit_title)
        elif ext in [".pptx", ".ppt"]:
            build_pptx_from_markdown(md_content, output_path, title=edit_title)
        else: # docx hoặc các định dạng khác
            build_docx_from_markdown(md_content, output_path, title=edit_title)
            
        return {
            "success": True,
            "file_id": file_id,
            "filename": out_filename,
            "download_url": f"/api/office/download/{out_filename}",
            "changelog": changelog,
            "preview_summary": md_content[:1000]
        }

    def evaluate_documents(
        self,
        submission_path: str,
        answer_key_path: str,
        criteria_notes: str = "",
        model_name: str = "qwen2.5:14b"
    ) -> Dict[str, Any]:
        """Chấm điểm và đối chiếu file bài nộp với file đáp án mẫu"""
        sub_info = extract_any_document(submission_path)
        ans_info = extract_any_document(answer_key_path)
        
        result = run_evaluation(
            submission_info=sub_info,
            answer_key_info=ans_info,
            criteria_notes=criteria_notes,
            llm_service=self.llm_service,
            model_name=model_name,
            output_dir=self.upload_dir
        )
        
        eval_json = result.get("evaluation", {})
        report_docx_filename = eval_json.get("report_docx_filename", "")
        
        return {
            "success": True,
            "evaluation": eval_json,
            "report_download_url": f"/api/office/download/{report_docx_filename}" if report_docx_filename else "",
            "report_filename": report_docx_filename
        }
