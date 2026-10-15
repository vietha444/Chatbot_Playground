"""
Tiện ích xử lý và sửa lỗi JSON an toàn cho các phản hồi từ mô hình LLM Local.
"""
import re
import json
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

def robust_extract_json(text: str) -> Optional[Dict[str, Any]]:
    """
    Trích xuất và tự động sửa các lỗi cú pháp JSON phổ biến của LLM:
    - Thiếu đóng ``` hoặc chèn text ngoài JSON
    - Trailing commas (dấu phẩy thừa trước } hoặc ])
    - Chú thích // comment
    - Escape ký tự điều khiển
    - Fallback regex bóc tách trường dữ liệu
    """
    if not text or not isinstance(text, str):
        return None
        
    first_b = text.find('{')
    last_b = text.rfind('}')
    if first_b != -1 and last_b != -1 and last_b > first_b:
        candidate = text[first_b:last_b+1]
    else:
        candidate = text.strip()

    # 1. Thử parse trực tiếp
    try:
        return json.loads(candidate)
    except Exception:
        pass

    # 2. Xóa trailing commas (dấu phẩy thừa trước } hoặc ])
    fixed = re.sub(r',(\s*[}\]])', r'\1', candidate)
    try:
        return json.loads(fixed)
    except Exception:
        pass

    # 3. Xóa các dòng chú thích // comment
    fixed2 = re.sub(r'//[^\n]*\n', '\n', fixed)
    fixed2 = re.sub(r',(\s*[}\]])', r'\1', fixed2)
    try:
        return json.loads(fixed2)
    except Exception:
        pass

    # 4. Thử tìm khối trong ```json ... ```
    match = re.search(r'```(?:json)?\s*(\{[\s\S]*?\})\s*(?:```)?', text)
    if match:
        code_block = match.group(1).strip()
        code_block = re.sub(r',(\s*[}\]])', r'\1', code_block)
        try:
            return json.loads(code_block)
        except Exception:
            pass

    # 5. Regex extraction fallback nếu JSON bị cụt hoặc lỗi cú pháp sâu
    try:
        title_m = re.search(r'\"title\"\s*:\s*\"([^\"]+)\"', text)
        if title_m:
            extracted = {
                "title": title_m.group(1),
                "sections": []
            }
            sec_blocks = re.split(r'\"heading\"\s*:\s*\"', text)[1:]
            for sb in sec_blocks:
                parts = sb.split('"', 1)
                h_name = parts[0]
                rest = parts[1] if len(parts) > 1 else ""
                
                # Check for content array
                p_match = re.search(r'\"content\"\s*:\s*\[(.*?)\]', rest, re.DOTALL)
                b_match = re.search(r'\"items\"\s*:\s*\[(.*?)\]', rest, re.DOTALL)
                
                if p_match:
                    strings = re.findall(r'\"([^\"]+)\"', p_match.group(1))
                    if strings:
                        extracted["sections"].append({
                            "heading": h_name,
                            "level": 1,
                            "type": "paragraphs",
                            "content": strings
                        })
                elif b_match:
                    strings = re.findall(r'\"([^\"]+)\"', b_match.group(1))
                    if strings:
                        extracted["sections"].append({
                            "heading": h_name,
                            "level": 1,
                            "type": "bullets",
                            "items": strings
                        })
                else:
                    # Lấy text trong quotes bất kỳ sau heading
                    strings = re.findall(r'\"([^\"]{10,})\"', rest)
                    if strings:
                        extracted["sections"].append({
                            "heading": h_name,
                            "level": 1,
                            "type": "paragraphs",
                            "content": strings[:3]
                        })
                        
            if extracted["sections"]:
                return extracted
    except Exception as e:
        logger.warning(f"Lỗi regex fallback extraction: {e}")

    return None


def clean_raw_llm_text(text: str) -> str:
    """Loại bỏ các thẻ markdown code fences thô và cú pháp JSON nếu có"""
    if not text:
        return ""
    lines = text.strip().split("\n")
    cleaned_lines = []
    in_code_fence = False
    
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("```"):
            in_code_fence = not in_code_fence
            continue
        # Bỏ qua các dấu ngoặc nhọn thuần túy của JSON
        if stripped in ["{", "}", "[", "]", "},", "],"]:
            continue
        # Bỏ qua các key JSON thô như "title": "..."
        if re.match(r'^\"[a-zA-Z0-9_]+\"\s*:\s*.*$', stripped):
            # Nếu là title, trích xuất text
            tm = re.match(r'^\"(?:title|heading)\"\s*:\s*\"([^\"]+)\"', stripped)
            if tm:
                cleaned_lines.append(f"## {tm.group(1)}")
            continue
            
        cleaned_lines.append(line)
        
    return "\n".join(cleaned_lines).strip()
