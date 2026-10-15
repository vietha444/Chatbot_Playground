"""
OCRService - Hệ thống Nhận diện và Bóc tách Tài liệu Khoa học & Công thức Toán học.
Kế thừa và nâng cấp toàn diện từ hệ thống OCR cũ (YOLO Router + Pix2Text + LatexOCR + Ollama Corrector).

Tính năng:
- Hỗ trợ PDF (PyMuPDF / Poppler) và Ảnh (PNG, JPG, WEBP).
- Phân tích bố cục thông minh (Layout Analysis): Math, Text, Table, Figure, Title.
- Sắp xếp thứ tự đọc chuẩn xác: Hỗ trợ Bố cục 2 cột (IEEE) và Băn bản 1 cột.
- Bỏ qua Header/Footer gây nhiễu (SKIP_TYPES).
- Trích xuất ảnh công thức toán (Math Gallery) và ảnh minh họa (Figures Gallery).
- Bộ xử lý hậu kỳ LaTeX Post-Processor (Bảo vệ khối toán học, chuyển đổi bảng biểu, escape ký tự).
- Sửa lỗi cú pháp và chính tả tiếng Việt tự động bằng mô hình AI cục bộ qua Ollama.
"""

import os
import io
import re
import json
import base64
import requests
from typing import List, Dict, Any, Tuple, Optional
from PIL import Image, ImageDraw, ImageFont
import numpy as np

import sys
if sys.platform.startswith('win'):
    try:
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        if hasattr(sys.stderr, 'reconfigure'):
            sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

# Ngan TensorFlow xung dot Protobuf voi Transformers
os.environ["TRANSFORMERS_NO_TF"] = "1"
os.environ["USE_TF"] = "0"

from core.config import Config

# ==============================================================================
# HẰNG SỐ & ĐỊNH NGHĨA BLOCK TYPES (TỪ HỆ THỐNG CŨ)
# ==============================================================================
BLOCK_COLORS: Dict[str, Tuple[str, str]] = {
    "title":             ("#22c55e", "#22c55e"),   # 🟢 Xanh lá
    "paragraph":         ("#3b82f6", "#3b82f6"),   # 🔵 Xanh dương
    "text":              ("#3b82f6", "#3b82f6"),
    "isolated_formula":  ("#ef4444", "#ef4444"),   # 🔴 Đỏ
    "embedding_formula": ("#f97316", "#f97316"),   # 🟠 Cam (inline)
    "formula":           ("#ef4444", "#ef4444"),
    "equation":          ("#ef4444", "#ef4444"),
    "math":              ("#ef4444", "#ef4444"),
    "table":             ("#eab308", "#eab308"),   # 🟡 Vàng
    "figure":            ("#a855f7", "#a855f7"),   # 🟣 Tím
    "image":             ("#a855f7", "#a855f7"),
    "list":              ("#06b6d4", "#06b6d4"),   # 🩵 Xanh nhạt
    "header":            ("#9ca3af", "#9ca3af"),   # ⚪ Xám (bỏ qua)
    "footer":            ("#9ca3af", "#9ca3af"),
    "page_number":       ("#9ca3af", "#9ca3af"),
}

SKIP_TYPES = {"header", "footer", "page_number"}
MATH_TYPES = {"isolated_formula", "embedding_formula", "formula", "equation", "math", "isolated", "embedding"}
FIGURE_TYPES = {"figure", "image", "picture"}
TABLE_TYPES = {"table"}
TITLE_TYPES = {"title", "section", "subsection"}

def _color_for(b_type: str) -> Tuple[str, str]:
    for key, val in BLOCK_COLORS.items():
        if key in b_type.lower():
            return val
    return ("#6b7280", "#6b7280")

def _hex_to_rgb(hex_color: str) -> Tuple[int, int, int]:
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


# ==============================================================================
# HẬU KỲ LATEX & BẢO VỆ CÔNG THỨC TOÁN (LATEX POST-PROCESSOR)
# ==============================================================================
def clean_latex_hallucinations(text: str) -> str:
    """Xóa các chuỗi hallucination thường gặp của OCR."""
    if not text:
        return ""
    hallucinations = [
        "[MISSING_PAGE_POST]",
        "[MISSING_PAGE_EMPTY]",
        "[MISSING_PAGE_FAIL]",
        "\\end{equation} (orphaned)",
        "\\end{aligned} (orphaned)"
    ]
    for h in hallucinations:
        text = text.replace(h, "")
    return text.strip()


def markdown_table_to_latex(md_table: str) -> str:
    """Chuyển đổi bảng Markdown cơ bản thành dạng LaTeX \\begin{tabular}."""
    lines = md_table.strip().split('\n')
    if not lines or len(lines) < 2:
        return md_table
        
    sep_line = lines[1]
    if '|' not in sep_line:
        return md_table
        
    cols_count = sep_line.count('|') - 1
    if cols_count <= 0:
        return md_table
        
    col_format = "c" * cols_count
    latex_lines = [
        f"\\begin{{tabular}}{{{col_format}}}",
        "\\hline"
    ]
    
    for i, line in enumerate(lines):
        if i == 1:
            continue
        cells = [cell.strip() for cell in line.split('|')][1:-1]
        if not cells:
            continue
        row_str = " & ".join(cells) + " \\\\"
        latex_lines.append(row_str)
        if i == 0:
            latex_lines.append("\\hline")
            
    latex_lines.append("\\hline")
    latex_lines.append("\\end{tabular}")
    return "\n".join(latex_lines)


def markdown_to_pure_latex(text: str) -> str:
    """
    Dịch Markdown sang LaTeX chuẩn:
    - Bảo vệ an toàn các khối toán học bằng placeholder không trùng lặp.
    - Chuyển đổi Heading (#, ##) sang \\section*, \\subsection*.
    - Chuyển đổi **Bold** và *Italic* (giữ nguyên _ trong công thức).
    - Thoát ký tự đặc biệt %, &, _, # cho phần text thông thường.
    """
    if not text.strip():
        return ""

    math_blocks = []
    PLACEHOLDER = "___MATHBLOCK_{}___"
    
    # Regex nhận diện toàn bộ các dạng công thức toán học
    math_pattern = re.compile(
        r'(\$\$.*?\$\$|\\\[.*?\\\]|\\\(.*?\\\)|(?<!\\)\$.+?(?<!\\)\$|\\begin\{[a-zA-Z*]+\}.*?\\end\{[a-zA-Z*]+\})',
        re.DOTALL
    )

    def mask_math(m):
        idx = len(math_blocks)
        math_blocks.append(m.group(0))
        return PLACEHOLDER.format(idx)

    temp_text = math_pattern.sub(mask_math, text)

    # Xử lý bảng Markdown
    def replace_md_table(m):
        return "\n" + markdown_table_to_latex(m.group(1)) + "\n"
    tbl_pattern = r'((?:^|\n)\|.*\|\n\|[-:| ]+\|\n(?:\|.*\|(?:\n|$))*)'
    temp_text = re.sub(tbl_pattern, replace_md_table, temp_text)

    # Headings
    def replace_heading(m):
        level = len(m.group(1))
        content = m.group(2).strip()
        if level == 1:
            return f"\\section*{{{content}}}"
        elif level == 2:
            return f"\\subsection*{{{content}}}"
        else:
            return f"\\subsubsection*{{{content}}}"
    temp_text = re.sub(r'^(#{1,6})\s+(.+)$', replace_heading, temp_text, flags=re.MULTILINE)
    
    # Bold (**text**)
    temp_text = re.sub(r'\*\*(.*?)\*\*', r'\\textbf{\1}', temp_text)
    
    # Italic (*text* - tuyệt đối không dùng _ vì sẽ phá hủy chỉ số dưới)
    temp_text = re.sub(r'(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)', r'\\textit{\1}', temp_text)
    
    # Thoát ký tự đặc biệt trong text thường
    temp_text = re.sub(r'(?<!\\)%', r'\%', temp_text)
    temp_text = re.sub(r'(?<!\\)&', r'\&', temp_text)
    temp_text = re.sub(r'(?<!\\)_', r'\_', temp_text)
    temp_text = re.sub(r'(?<!\\)#', r'\#', temp_text)

    # Phục hồi công thức toán học nguyên vẹn
    for i, block in enumerate(math_blocks):
        temp_text = temp_text.replace(PLACEHOLDER.format(i), block)
        
    return clean_latex_hallucinations(temp_text)


# ==============================================================================
# OLLAMA LOCAL AI POST-CORRECTOR (SỬA LỖI & TỐI ƯU BẰNG MÔ HÌNH LOCAL)
# ==============================================================================
def correct_ocr_with_ollama(
    text: str,
    model_name: str = "qwen2.5:14b",
    output_format: str = "markdown"
) -> str:
    """
    Sử dụng Ollama Local LLM để:
    - Sửa cú pháp công thức toán LaTeX (ngoặc nhọn, phân số, ký hiệu).
    - Sửa lỗi chính tả & dấu tiếng Việt bị mờ do scan.
    - Giữ nguyên cấu trúc văn bản, KHÔNG sinh thêm nội dung và KHÔNG dịch thuật.
    """
    if not text.strip():
        return text

    # Chọn endpoint Ollama khả dụng
    endpoints = [Config.OLLAMA_LOCAL_URL, Config.OLLAMA_REMOTE_URL]
    api_url = None
    for ep in endpoints:
        try:
            r = requests.get(f"{ep}/api/tags", timeout=2)
            if r.status_code == 200:
                api_url = ep
                break
        except Exception:
            continue

    if not api_url:
        print("[OCRService] Cannot connect to Ollama. Keeping raw OCR text.")
        return text

    if output_format == "markdown":
        system_prompt = (
            "You are an expert bilingual (Vietnamese and English) technical editor. Your task is to fix, format, and beautify OCR-generated Markdown text.\n"
            "CRITICAL RULES:\n"
            "1. NO conversational filler. Do not start with 'Here is the corrected text...'.\n"
            "2. NO markdown wrapping (like ```markdown). Output raw text directly.\n"
            "3. DO NOT invent, hallucinate, or translate content. Preserve original language.\n"
            "4. KEEP the output in clean MARKDOWN format (e.g., use **bold**, # headings, $...$, $$...$$ for math)."
        )
        user_prompt = (
            "Please fix and polish the following OCR-extracted Markdown document.\n"
            "Tasks:\n"
            "1. Fix syntax errors in math formulas ($...$ or $$...$$).\n"
            "2. CORRECT VIETNAMESE ACCENTS: Fix missing or garbled diacritics in Vietnamese words.\n"
            "3. STRICT CONSTRAINT: Do NOT change the meaning or add new content.\n\n"
            f"Raw Document:\n{text}"
        )
    else:
        system_prompt = (
            "You are an expert bilingual (Vietnamese and English) LaTeX typesetter. Your task is to convert and clean OCR-generated text into PURE LaTeX.\n"
            "CRITICAL RULES:\n"
            "1. NO conversational filler. Do not include introductory notes.\n"
            "2. NO markdown formatting. Do not wrap output in ```latex ... ```.\n"
            "3. Return ONLY valid LaTeX document body without \\documentclass or \\begin{document}.\n"
            "4. Fix math errors and Vietnamese diacritics, preserving the original language."
        )
        user_prompt = (
            "Please fix, convert, and beautify the following OCR text into clean LaTeX.\n"
            "Tasks:\n"
            "1. Convert Markdown headers to \\section*, bold to \\textbf, etc.\n"
            "2. Fix syntax errors in math equations.\n"
            "3. Fix typos and missing diacritics in Vietnamese words.\n\n"
            f"Raw Document:\n{text}"
        )

    payload = {
        "model": model_name,
        "system": system_prompt,
        "prompt": user_prompt,
        "stream": False,
        "options": {
            "temperature": 0.1,
            "num_predict": 4096
        }
    }

    try:
        resp = requests.post(f"{api_url}/api/generate", json=payload, timeout=90)
        if resp.status_code == 200:
            result = resp.json()
            corrected = result.get("response", "").strip()
            # Dọn dẹp codeblock wrapper nếu LLM lỡ sinh ra
            corrected = re.sub(r"^```(?:latex|tex|markdown)?\s*", "", corrected, flags=re.IGNORECASE)
            corrected = re.sub(r"\s*```$", "", corrected)
            return corrected.strip()
    except Exception as e:
        print(f"[OCRService] Lỗi khi gọi Ollama corrector: {e}")

    return text


# ==============================================================================
# OCR SERVICE CHÍNH
# ==============================================================================
class OCRService:
    _p2t_instance = None
    _latex_ocr_instance = None

    def __init__(self):
        self.upload_dir = Config.UPLOAD_FOLDER
        os.makedirs(self.upload_dir, exist_ok=True)

    @classmethod
    def get_pix2text(cls, languages: Tuple[str, ...] = ('vi', 'en')):
        """Khởi tạo Pix2Text Singleton Lazy Loading."""
        if cls._p2t_instance is None:
            print(f"[OCRService] Loading Pix2Text engine with languages: {languages}...")
            try:
                import onnxruntime as ort
                ort.set_default_logger_severity(3)
            except Exception:
                pass

            try:
                from pix2text import Pix2Text
                import torch
                device = "cuda" if torch.cuda.is_available() else "cpu"
                cls._p2t_instance = Pix2Text.from_config(
                    languages=languages,
                    device=device,
                    mfd_config={'backend': 'pytorch'},
                    layout_config={'backend': 'pytorch'}
                )
                print(f"[OCRService] Pix2Text ready on device: {device}")
            except Exception as e:
                print(f"[OCRService] GPU init warning, falling back to CPU: {e}")
                try:
                    from pix2text import Pix2Text
                    cls._p2t_instance = Pix2Text.from_config(
                        languages=languages,
                        device='cpu',
                        mfd_config={'backend': 'pytorch'},
                        layout_config={'backend': 'pytorch'}
                    )
                    print("[OCRService] Pix2Text ready on CPU device.")
                except Exception as ex2:
                    print(f"[OCRService] Pix2Text init failed: {ex2}")
                    cls._p2t_instance = None
        return cls._p2t_instance

    @classmethod
    def get_latex_ocr(cls):
        """Khoi tao LatexOCR (pix2tex) chuyen biet cho cong thuc toan."""
        if cls._latex_ocr_instance is None:
            try:
                from pix2tex.cli import LatexOCR
                cls._latex_ocr_instance = LatexOCR()
                print("[OCRService] LatexOCR (pix2tex) is ready.")
            except Exception as e:
                print(f"[OCRService] LatexOCR unavailable: {e}")
                cls._latex_ocr_instance = None
        return cls._latex_ocr_instance

    def render_pdf_to_images(self, pdf_path: str, dpi: int = 150) -> List[Image.Image]:
        """Chuyển đổi PDF thành ảnh bằng PyMuPDF (nhanh, chuẩn xác, không cần poppler)."""
        images = []
        try:
            import fitz
            doc = fitz.open(pdf_path)
            zoom = dpi / 72.0
            matrix = fitz.Matrix(zoom, zoom)
            for page in doc:
                pix = page.get_pixmap(matrix=matrix)
                img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                images.append(img)
            doc.close()
            return images
        except Exception as e:
            print(f"[OCRService] Lỗi render bằng PyMuPDF: {e}. Thử fallback sang pdf2image...")

        try:
            from pdf2image import convert_from_path
            return convert_from_path(pdf_path, dpi=dpi, poppler_path=Config.POPPLER_PATH)
        except Exception as ex2:
            print(f"[OCRService] Lỗi pdf2image: {ex2}")
            return []

    def sort_reading_order(
        self,
        blocks: List[Dict[str, Any]],
        image_width: int,
        two_column: bool = True
    ) -> List[Dict[str, Any]]:
        """
        Sắp xếp các block theo thứ tự đọc tự nhiên:
        - two_column=True: Bố cục 2 cột (IEEE / Đề thi): Đọc cột trái từ trên xuống dưới, sau đó đọc cột phải.
        - two_column=False: Văn bản 1 cột: Sắp xếp theo trục y từ trên xuống dưới.
        """
        if not two_column:
            return sorted(blocks, key=lambda b: b["bbox"][1])

        midpoint = image_width / 2.0
        left_col = [b for b in blocks if b["bbox"][0] < midpoint]
        right_col = [b for b in blocks if b["bbox"][0] >= midpoint]

        left_col.sort(key=lambda b: b["bbox"][1])
        right_col.sort(key=lambda b: b["bbox"][1])

        return left_col + right_col

    def draw_annotated(self, image: Image.Image, blocks: List[Dict[str, Any]]) -> Image.Image:
        """
        Vẽ bounding box kèm nhãn và số thứ tự đọc (#1, #2,...) lên ảnh.
        Nhãn được bố trí bên trong góc trên của box để không bị chồng lấn.
        """
        annotated = image.copy().convert("RGB")
        draw = ImageDraw.Draw(annotated, "RGBA")

        font_size = max(12, min(16, image.width // 80))
        font = None
        for fn in ["arial.ttf", "Arial.ttf", "DejaVuSans.ttf"]:
            try:
                font = ImageFont.truetype(fn, font_size)
                break
            except Exception:
                pass
        if font is None:
            font = ImageFont.load_default()

        PAD = 3
        LINE = 2

        for b in blocks:
            b_type = b.get("type", "unknown")
            x1, y1, x2, y2 = [float(v) for v in b["bbox"]]
            x1 = max(0, x1); y1 = max(0, y1)
            x2 = min(image.width - 1, x2); y2 = min(image.height - 1, y2)

            outline, bg = _color_for(b_type)

            if b_type in SKIP_TYPES:
                # Vẽ nét xám mờ cho phần bị bỏ qua
                draw.rectangle([x1, y1, x2, y2], outline="#9ca3af", width=1)
                continue

            draw.rectangle([x1, y1, x2, y2], outline=outline, width=LINE)

            order = b.get("order", 1)
            label = f"#{order} {b_type}"
            conf = b.get("confidence", 1.0)
            if conf < 0.99:
                label += f" {conf:.0%}"

            try:
                bbox_text = font.getbbox(label)
                tw = bbox_text[2] - bbox_text[0]
                th = bbox_text[3] - bbox_text[1]
            except Exception:
                tw = len(label) * (font_size // 2 + 1)
                th = font_size + 2

            box_w = x2 - x1
            box_h = y2 - y1
            if box_w > tw + PAD * 2 + 4 and box_h > th + PAD * 2:
                lx1 = x1 + LINE
                ly1 = y1 + LINE
                lx2 = lx1 + tw + PAD * 2
                ly2 = ly1 + th + PAD * 2
                r, g, b_col = _hex_to_rgb(bg)
                draw.rectangle([lx1, ly1, lx2, ly2], fill=(r, g, b_col, 220))
                draw.text((lx1 + PAD, ly1 + PAD), label, fill="white", font=font)
            elif box_w > 20 and box_h > 12:
                draw.text((x1 + LINE + 1, y1 + LINE + 1), f"#{order}", fill=outline, font=font)

        return annotated

    def extract_full_document(
        self,
        file_path: str,
        two_column: bool = True,
        output_format: str = "markdown",
        use_ollama: bool = False,
        ollama_model: Optional[str] = "qwen2.5:14b",
        conf_threshold: float = 0.25,
        languages: Tuple[str, ...] = ('vi', 'en'),
        dpi: int = 150
    ) -> Dict[str, Any]:
        """
        Bóc tách toàn diện tài liệu (PDF hoặc Ảnh) với routing thông minh,
        sắp xếp thứ tự đọc 2 cột/1 cột, bóc tách công thức toán, biểu đồ,
        và tùy chọn sửa lỗi tự động bằng mô hình AI Local Ollama.
        """
        ext = os.path.splitext(file_path)[1].lower()
        if ext == ".pdf":
            page_images = self.render_pdf_to_images(file_path, dpi=dpi)
        elif ext in [".png", ".jpg", ".jpeg", ".bmp", ".webp"]:
            page_images = [Image.open(file_path).convert("RGB")]
        else:
            return {"error": f"Định dạng file không được hỗ trợ: {ext}"}

        if not page_images:
            return {"error": "Không thể trích xuất trang nào từ tài liệu này."}

        p2t = self.get_pix2text(languages=languages)
        latex_ocr = self.get_latex_ocr()

        all_pages_data = []
        global_formulas = []
        global_figures = []
        full_text_pages = []

        total_pages = len(page_images)
        print(f"[OCRService] Bat dau xu ly {total_pages} trang (2-cot: {two_column}, Format: {output_format}, AI Fix: {use_ollama})...")

        for page_idx, page_img in enumerate(page_images):
            page_w, page_h = page_img.size
            raw_blocks = []

            # 1. Layout Parsing
            if p2t and hasattr(p2t, 'layout_parser'):
                try:
                    parse_res = p2t.layout_parser.parse(page_img, False, conf=conf_threshold)
                    blocks_list = parse_res[0] if isinstance(parse_res, tuple) else parse_res
                    for blk in blocks_list:
                        b_type = str(blk.get('type', 'text')).lower()
                        if '.' in b_type:
                            b_type = b_type.split('.')[-1]
                        pos = blk.get('position', None)
                        if pos is None:
                            continue
                        try:
                            pos_arr = np.array(pos)
                            x1, x2 = float(np.min(pos_arr[:, 0])), float(np.max(pos_arr[:, 0]))
                            y1, y2 = float(np.min(pos_arr[:, 1])), float(np.max(pos_arr[:, 1]))
                            if x2 - x1 > 4 and y2 - y1 > 4:
                                raw_blocks.append({
                                    "type": b_type,
                                    "bbox": [x1, y1, x2, y2],
                                    "confidence": float(blk.get('score', 1.0))
                                })
                        except Exception:
                            continue
                except Exception as e:
                    print(f"[OCRService] Lỗi layout_parser trang {page_idx + 1}: {e}")

            # Fallback nếu không phát hiện block nào: coi toàn bộ trang là một block
            if not raw_blocks:
                raw_blocks.append({
                    "type": "paragraph",
                    "bbox": [0, 0, page_w, page_h],
                    "confidence": 1.0
                })

            # 2. Sắp xếp thứ tự đọc (IEEE 2-cột hoặc 1-cột)
            sorted_blocks = self.sort_reading_order(raw_blocks, page_w, two_column=two_column)
            for idx, b in enumerate(sorted_blocks):
                b["order"] = idx + 1

            # 3. OCR từng block theo routing
            page_text_parts = []
            page_formulas = []
            page_figures = []

            for b in sorted_blocks:
                b_type = b["type"]
                x1, y1, x2, y2 = [int(v) for v in b["bbox"]]
                pad = 3
                cx1, cy1 = max(0, x1 - pad), max(0, y1 - pad)
                cx2, cy2 = min(page_w, x2 + pad), min(page_h, y2 + pad)
                crop_img = page_img.crop((cx1, cy1, cx2, cy2))

                # Lưu ảnh crop base64
                def to_b64(img):
                    buf = io.BytesIO()
                    img.save(buf, format="JPEG", quality=85)
                    return base64.b64encode(buf.getvalue()).decode("utf-8")

                # Bỏ qua Header/Footer
                if b_type in SKIP_TYPES:
                    continue

                # Nhận diện Công thức Toán
                if any(k in b_type for k in MATH_TYPES):
                    latex_str = ""
                    try:
                        if p2t:
                            res = p2t.recognize_formula(crop_img)
                            latex_str = res.get("text", str(res)) if isinstance(res, dict) else str(res)
                        elif latex_ocr:
                            latex_str = latex_ocr(crop_img)
                    except Exception:
                        if latex_ocr:
                            try:
                                latex_str = latex_ocr(crop_img)
                            except Exception:
                                pass

                    latex_str = latex_str.strip()
                    crop_b64 = to_b64(crop_img)

                    formula_item = {
                        "page": page_idx + 1,
                        "box_idx": b["order"],
                        "type": b_type,
                        "latex": latex_str,
                        "crop_image_b64": crop_b64,
                        "bbox": b["bbox"],
                        "confidence": b["confidence"]
                    }
                    page_formulas.append(formula_item)
                    global_formulas.append(formula_item)

                    if output_format.startswith("pure_latex"):
                        page_text_parts.append(f"\n\\[\n{latex_str}\n\\]\n")
                    else:
                        page_text_parts.append(f"\n$$\n{latex_str}\n$$\n")

                # Bóc tách Bảng biểu
                elif any(k in b_type for k in TABLE_TYPES):
                    tbl_text = ""
                    try:
                        if p2t:
                            res = p2t.recognize(crop_img)
                            tbl_text = res.get("text", str(res)) if isinstance(res, dict) else str(res)
                    except Exception:
                        pass

                    tbl_text = tbl_text.strip()
                    if output_format.startswith("pure_latex"):
                        page_text_parts.append("\n" + markdown_table_to_latex(tbl_text) + "\n")
                    else:
                        page_text_parts.append("\n" + tbl_text + "\n")

                # Bóc tách Hình vẽ / Biểu đồ
                elif any(k in b_type for k in FIGURE_TYPES):
                    crop_b64 = to_b64(crop_img)
                    fig_item = {
                        "page": page_idx + 1,
                        "box_idx": b["order"],
                        "crop_image_b64": crop_b64,
                        "bbox": b["bbox"]
                    }
                    page_figures.append(fig_item)
                    global_figures.append(fig_item)

                    if output_format.startswith("pure_latex"):
                        page_text_parts.append(f"\n% [HÌNH VẼ #{b['order']} - Xem tab hình ảnh trích xuất]\n")
                    else:
                        page_text_parts.append(f"\n*[Hình vẽ #{b['order']} đã được trích xuất riêng biệt]*\n")

                # Tiêu đề
                elif any(k in b_type for k in TITLE_TYPES):
                    title_text = ""
                    try:
                        if p2t:
                            res = p2t.recognize(crop_img)
                            title_text = res.get("text", str(res)) if isinstance(res, dict) else str(res)
                    except Exception:
                        pass
                    title_text = title_text.strip()
                    if output_format.startswith("pure_latex"):
                        page_text_parts.append(f"\n\\section*{{{title_text}}}\n")
                    else:
                        page_text_parts.append(f"\n### {title_text}\n")

                # Đoạn văn bản thông thường
                else:
                    block_text = ""
                    try:
                        if p2t:
                            res = p2t.recognize(crop_img)
                            block_text = res.get("text", str(res)) if isinstance(res, dict) else str(res)
                    except Exception:
                        pass
                    block_text = block_text.strip()
                    if block_text:
                        page_text_parts.append(block_text)

            # 4. Vẽ ảnh Annotated với Bounding Box màu & Số thứ tự
            annotated_img = self.draw_annotated(page_img, sorted_blocks)
            annotated_b64 = to_b64(annotated_img)

            page_assembled_text = "\n\n".join(page_text_parts).strip()
            full_text_pages.append(f"## Trang {page_idx + 1}\n\n{page_assembled_text}")

            all_pages_data.append({
                "page_number": page_idx + 1,
                "formulas_count": len(page_formulas),
                "figures_count": len(page_figures),
                "formulas": page_formulas,
                "figures": page_figures,
                "text": page_assembled_text,
                "annotated_image_b64": annotated_b64,
                "blocks_count": len(sorted_blocks)
            })

        total_extracted_text = "\n\n".join(full_text_pages).strip()

        # Áp dụng Pure LaTeX Post-Processor nếu người dùng yêu cầu
        if output_format.startswith("pure_latex"):
            total_extracted_text = markdown_to_pure_latex(total_extracted_text)

        # 5. Sửa lỗi tự động qua mô hình Ollama nếu bật
        corrected_text = ""
        if use_ollama:
            print(f"[OCRService] Calling Ollama ({ollama_model}) for syntax & diacritics correction...")
            model_to_use = ollama_model or "qwen2.5:14b"
            corrected_text = correct_ocr_with_ollama(
                text=total_extracted_text,
                model_name=model_to_use,
                output_format=output_format
            )

        # 6. Tạo Chunks cho RAG
        final_rag_text = corrected_text if (use_ollama and corrected_text) else total_extracted_text
        try:
            from langchain.text_splitter import RecursiveCharacterTextSplitter
            splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=150)
            chunks = [c.page_content for c in splitter.create_documents([final_rag_text])]
        except Exception:
            chunks = [final_rag_text[i:i+800] for i in range(0, len(final_rag_text), 700)]

        return {
            "total_pages": total_pages,
            "pages": all_pages_data,
            "formulas": global_formulas,
            "figures": global_figures,
            "full_text": total_extracted_text,
            "corrected_text": corrected_text,
            "chunks": chunks,
            "filename": os.path.basename(file_path),
            "two_column": two_column,
            "output_format": output_format,
            "use_ollama": use_ollama
        }
