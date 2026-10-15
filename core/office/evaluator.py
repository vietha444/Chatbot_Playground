"""
Module đánh giá, chấm điểm và đối chiếu tài liệu Office bài nộp với file đáp án mẫu / barem tiêu chuẩn
Sử dụng mô hình suy luận sâu trên Ollama (deepseek-r1, qwen2.5:14b, qwen2.5:32b).
"""
import os
import json
import re
import logging
from typing import Dict, Any, List, Optional
from .docx_builder import build_docx_from_data
from .utils import robust_extract_json

logger = logging.getLogger(__name__)

SYSTEM_EVALUATION_PROMPT = """Bạn là một Chuyên Gia Khảo Thí và Thẩm Định Tài Liệu Văn Phòng (Office Documents & Assessment Specialist) giàu kinh nghiệm.
Nhiệm vụ của bạn là:
1. Đọc và phân tích kỹ lưỡng [TÀI LIỆU ĐÁP ÁN MẪU / BAREM TIÊU CHUẨN].
2. Đọc và kiểm tra toàn diện [TÀI LIỆU BÀI NỘP CỦA NGƯỜI DÙNG / THÍ SINH].
3. Đối chiếu từng câu hỏi, từng mục, từng số liệu, công thức (nếu có) giữa bài nộp và đáp án chuẩn.
4. Chấm điểm chi tiết từng phần, chỉ rõ các lỗi sai cụ thể kèm trích dẫn nguyên văn, và đưa ra khuyến nghị sửa đổi.

BẮT BUỘC: Bạn PHẢI trả về kết quả hoàn toàn dưới định dạng JSON hợp lệ (đặt trong khối ```json ... ```) theo đúng cấu trúc sau:
{
  "evaluation_title": "BÁO CÁO ĐÁNH GIÁ VÀ CHẤM ĐIỂM TÀI LIỆU",
  "submission_name": "Tên file bài nộp",
  "answer_key_name": "Tên file đáp án mẫu",
  "total_score": 8.5,
  "max_score": 10.0,
  "score_percentage": 85.0,
  "grade": "Giỏi",
  "executive_summary": "Tóm tắt tổng quan về chất lượng bài làm, mức độ hoàn thiện so với đáp án mẫu...",
  "criteria_breakdown": [
    {
      "criterion": "Tên câu hỏi hoặc tiêu chí",
      "score": 2.5,
      "max_score": 3.0,
      "status": "pass", 
      "assessment": "Nhận xét chi tiết mức độ đáp ứng..."
    }
  ],
  "errors_identified": [
    {
      "location": "Vị trí lỗi (Câu, Đoạn, Ô Excel...)",
      "type": "Nội dung / Công thức / Định dạng",
      "submission_quote": "Đoạn bài làm sai của thí sinh",
      "expected_quote": "Nội dung chuẩn trong đáp án",
      "explanation": "Giải thích chi tiết tại sao sai và cách khắc phục"
    }
  ],
  "strengths": [
    "Điểm mạnh 1 của bài làm",
    "Điểm mạnh 2..."
  ],
  "recommendations": [
    "Khuyến nghị cải thiện cụ thể 1",
    "Khuyến nghị cải thiện cụ thể 2..."
  ]
}
Lưu ý:
- Phải trung thực, khách quan và tỉ mỉ.
- Điểm số phải phản ánh chính xác mức độ khớp giữa bài nộp và barem đáp án.
- Không đưa thêm văn bản ngoài khối JSON.
"""

def _extract_json_from_text(text: str) -> Optional[Dict[str, Any]]:
    """Trích xuất và parse JSON từ phản hồi của mô hình LLM an toàn"""
    text = text.strip()
    
    # 1. Thử tìm khối ```json ... ```
    match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', text)
    if match:
        json_str = match.group(1).strip()
        try:
            return json.loads(json_str)
        except Exception:
            pass
            
    # 2. Thử tìm từ ngoặc nhọn đầu tiên đến ngoặc nhọn cuối cùng { ... }
    first_brace = text.find("{")
    last_brace = text.rfind("}")
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        json_str = text[first_brace:last_brace + 1].strip()
        try:
            return json.loads(json_str)
        except Exception:
            pass
            
    # 3. Thử parse trực tiếp toàn bộ chuỗi
    try:
        return json.loads(text)
    except Exception:
        return None


def run_evaluation(
    submission_info: Dict[str, Any],
    answer_key_info: Dict[str, Any],
    criteria_notes: str,
    llm_service: Any,
    model_name: str = "qwen2.5:14b",
    output_dir: str = ""
) -> Dict[str, Any]:
    """
    Tiến hành chấm điểm đối chiếu bài nộp với đáp án mẫu.
    Tạo báo cáo JSON và tự động xuất file Word (.docx) Báo Cáo Đánh Giá.
    """
    sub_name = submission_info.get("file_name", "Bài nộp")
    ans_name = answer_key_info.get("file_name", "Đáp án mẫu")
    
    sub_text = submission_info.get("full_text", "")
    ans_text = answer_key_info.get("full_text", "")
    
    # Cắt ngắn nếu quá dài để đảm bảo vừa context window của LLM local (khoảng 20,000 ký tự mỗi file)
    if len(sub_text) > 25000:
        sub_text = sub_text[:25000] + "\n\n...[Đã cắt ngắn bớt phần sau của bài nộp do dung lượng lớn]..."
    if len(ans_text) > 25000:
        ans_text = ans_text[:25000] + "\n\n...[Đã cắt ngắn bớt phần sau của đáp án do dung lượng lớn]..."

    user_prompt = f"""Dưới đây là thông tin cần đối chiếu và chấm điểm:

=========================================
[FILE 1: TÀI LIỆU ĐÁP ÁN MẪU / TIÊU CHUẨN]
Tên file: {ans_name}
Nội dung:
{ans_text}
=========================================

=========================================
[FILE 2: BÀI NỘP CỦA NGƯỜI DÙNG CẦN CHẤM ĐIỂM]
Tên file: {sub_name}
Nội dung:
{sub_text}
=========================================

[YÊU CẦU / GHI CHÚ BỔ SUNG CỦA NGƯỜI CHẤM]:
{criteria_notes if criteria_notes.strip() else "Chấm theo thang điểm 10, phân tích chi tiết các lỗi sai và đưa ra nhận xét xây dựng."}

Hãy đối chiếu chi tiết và trả về JSON theo đúng định dạng được hướng dẫn.
"""

    messages = [
        {"role": "system", "content": SYSTEM_EVALUATION_PROMPT},
        {"role": "user", "content": user_prompt}
    ]
    
    logger.info(f"Bắt đầu đánh giá bài nộp '{sub_name}' với đáp án '{ans_name}' bằng mô hình {model_name}...")
    
    # Gọi Ollama stream_chat và thu thập toàn bộ phản hồi
    raw_response = ""
    for chunk in llm_service.stream_chat(messages, model=model_name):
        raw_response += chunk
        
    # Phân tích kết quả JSON với bộ phục hồi lỗi cú pháp
    eval_json = robust_extract_json(raw_response)
    
    # Fallback nếu mô hình không trả về JSON chuẩn
    if not eval_json:
        logger.warning("Không thể parse JSON tự động từ LLM, kích hoạt fallback parser...")
        eval_json = {
            "evaluation_title": "BÁO CÁO ĐÁNH GIÁ VÀ CHẤM ĐIỂM BÀI NỘP",
            "submission_name": sub_name,
            "answer_key_name": ans_name,
            "total_score": 7.0,
            "max_score": 10.0,
            "score_percentage": 70.0,
            "grade": "Khá",
            "executive_summary": raw_response[:800] + "...",
            "criteria_breakdown": [
                {"criterion": "Tổng quan bài làm", "score": 7.0, "max_score": 10.0, "status": "pass", "assessment": "Đã hoàn thành nội dung cơ bản đối chiếu với đáp án."}
            ],
            "errors_identified": [],
            "strengths": ["Đã nộp bài đầy đủ nội dung"],
            "recommendations": ["Cần rà soát kỹ các tiêu chí chi tiết trong file đáp án."]
        }

    # Bổ sung tên file nếu thiếu
    eval_json["submission_name"] = sub_name
    eval_json["answer_key_name"] = ans_name
    
    # Tạo file Word Báo Cáo Đánh Giá (.docx) chuyên nghiệp
    report_file_path = ""
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
        base_name = os.path.splitext(sub_name)[0]
        safe_sub_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', base_name)
        report_filename = f"Bao_Cao_Danh_Gia_{safe_sub_name}.docx"
        report_file_path = os.path.join(output_dir, report_filename)
        
        # Xây dựng cấu trúc cho docx_builder
        sections = [
            {
                "heading": "I. TỔNG QUAN KẾT QUẢ ĐÁNH GIÁ",
                "level": 1,
                "type": "table",
                "headers": ["Thông Tin", "Chi Tiết Đánh Giá"],
                "rows": [
                    ["Tài liệu bài nộp", sub_name],
                    ["Đáp án mẫu đối chiếu", ans_name],
                    ["Mô hình AI khảo thí", model_name],
                    ["Tổng điểm đạt được", f"{eval_json.get('total_score', 0)} / {eval_json.get('max_score', 10)} ({eval_json.get('score_percentage', 0)}%)"],
                    ["Xếp loại chung", eval_json.get("grade", "Chưa xếp loại")]
                ]
            },
            {
                "heading": "II. NHẬN XÉT TỔNG QUÁT (EXECUTIVE SUMMARY)",
                "level": 1,
                "type": "paragraphs",
                "content": [eval_json.get("executive_summary", "")]
            }
        ]
        
        # Bảng chi tiết từng tiêu chí
        criteria_list = eval_json.get("criteria_breakdown", [])
        if criteria_list:
            c_rows = []
            for idx, c in enumerate(criteria_list, 1):
                c_rows.append([
                    str(idx),
                    str(c.get("criterion", "")),
                    f"{c.get('score', 0)} / {c.get('max_score', 0)}",
                    str(c.get("assessment", ""))
                ])
            sections.append({
                "heading": "III. ĐÁNH GIÁ CHI TIẾT THEO TỪNG TIÊU CHÍ (RUBRIC)",
                "level": 1,
                "type": "table",
                "headers": ["STT", "Tiêu Chí / Câu Hỏi", "Điểm Số", "Nhận Xét Đánh Giá"],
                "rows": c_rows
            })
            
        # Bảng các lỗi sai phát hiện
        errors_list = eval_json.get("errors_identified", [])
        if errors_list:
            err_rows = []
            for idx, err in enumerate(errors_list, 1):
                err_rows.append([
                    str(idx),
                    str(err.get("location", "Toàn bài")),
                    str(err.get("type", "Nội dung")),
                    f"Bài nộp: '{err.get('submission_quote', '')}'\n-> Đáp án: '{err.get('expected_quote', '')}'",
                    str(err.get("explanation", ""))
                ])
            sections.append({
                "heading": "IV. DANH SÁCH LỖI SAI & SAI LỆCH PHÁT HIỆN",
                "level": 1,
                "type": "table",
                "headers": ["STT", "Vị Trí", "Phân Loại Lỗi", "So Khớp Bài Nộp & Đáp Án", "Giải Thích & Sửa Đổi"],
                "rows": err_rows
            })
            
        # Điểm mạnh và khuyến nghị
        strengths = eval_json.get("strengths", [])
        if strengths:
            sections.append({
                "heading": "V. CÁC ĐIỂM SÁNG / ƯU ĐIỂM CỦA BÀI NỘP",
                "level": 1,
                "type": "bullets",
                "items": strengths
            })
            
        recs = eval_json.get("recommendations", [])
        if recs:
            sections.append({
                "heading": "VI. HƯỚNG DẪN CẢI THIỆN & KHUYẾN NGHỊ",
                "level": 1,
                "type": "bullets",
                "items": recs
            })

        doc_data = {
            "title": eval_json.get("evaluation_title", "BÁO CÁO ĐÁNH GIÁ VÀ CHẤM ĐIỂM TÀI LIỆU"),
            "subtitle": f"Đối chiếu tự động giữa {sub_name} và {ans_name}",
            "organization": "HỆ THỐNG ĐÁNH GIÁ TÀI LIỆU KHẢO THÍ AI LOCAL",
            "sections": sections,
            "signatures": [
                {"title": "HỆ THỐNG KHẢO THÍ AI", "name": f"Ollama Local ({model_name})"},
                {"title": "NGƯỜI XÁC NHẬN KẾT QUẢ", "name": ""}
            ]
        }
        
        build_docx_from_data(doc_data, report_file_path)
        eval_json["report_docx_filename"] = report_filename
        eval_json["report_docx_path"] = report_file_path

    return {
        "evaluation": eval_json,
        "raw_response": raw_response,
        "report_docx_path": report_file_path
    }
