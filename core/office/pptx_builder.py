"""
Module tạo bài thuyết trình Microsoft PowerPoint (.pptx) chuyên nghiệp
Hỗ trợ tỷ lệ màn ảnh rộng 16:9, bảng màu hiện đại, slide tiêu đề, slide nội dung, bảng biểu và ghi chú thuyết trình.
"""
import os
import re
from typing import Dict, Any, List, Optional
import pptx
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

# Bảng màu chủ đạo Hiện Đại (Modern Corporate Navy & Cyan)
COLOR_PRIMARY = RGBColor(0x1E, 0x3A, 0x8A)    # Deep Navy
COLOR_SECONDARY = RGBColor(0x25, 0x63, 0xEB)  # Royal Blue
COLOR_ACCENT = RGBColor(0x06, 0xB6, 0xD4)     # Cyan
COLOR_DARK_TEXT = RGBColor(0x1F, 0x29, 0x37)  # Slate 800
COLOR_MUTED_TEXT = RGBColor(0x64, 0x74, 0x8B) # Slate 500
COLOR_LIGHT_BG = RGBColor(0xF8, 0xFA, 0xFC)   # Slate 50
COLOR_WHITE = RGBColor(0xFF, 0xFF, 0xFF)

def _init_widescreen_presentation() -> pptx.Presentation:
    """Khởi tạo Presentation với tỷ lệ màn ảnh rộng chuẩn 16:9"""
    prs = pptx.Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    return prs

def _add_solid_background(slide, prs, rgb_color: RGBColor):
    """Vẽ hình chữ nhật phủ toàn bộ slide làm nền màu"""
    bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    bg.fill.solid()
    bg.fill.fore_color.rgb = rgb_color
    bg.line.fill.background() # Không viền
    return bg

def build_pptx_from_data(data: Dict[str, Any], output_path: str) -> str:
    """
    Tạo file PowerPoint từ cấu trúc dữ liệu JSON.
    data format:
    {
        "title": "ỨNG DỤNG AI TRONG GIÁO DỤC HIỆN ĐẠI",
        "subtitle": "Kỷ nguyên số và các giải pháp thực tiễn",
        "presenter": "Chuyên gia AI - 2026",
        "slides": [
            {
                "title": "1. Tổng Quan Thị Trường",
                "bullets": ["Tốc độ tăng trưởng 35%/năm", "Được áp dụng rộng rãi trong đánh giá học tập"],
                "notes": "Nhấn mạnh số liệu 35% từ báo cáo Gartner"
            },
            {
                "title": "2. Bảng So Sánh Các Giải Pháp",
                "table": {
                    "headers": ["Tiêu chí", "Phương pháp cũ", "Trợ lý AI"],
                    "rows": [["Tốc độ chấm bài", "3-5 ngày", "Tức thì"], ["Độ chi tiết", "Ngắn gọn", "Toàn diện"]]
                }
            }
        ]
    }
    """
    prs = _init_widescreen_presentation()
    blank_layout = prs.slide_layouts[6] # Blank layout
    
    # ----------------------------------------------------
    # SLIDE 1: TIÊU ĐỀ CHÍNH (TITLE SLIDE)
    # ----------------------------------------------------
    slide_title_obj = prs.slides.add_slide(blank_layout)
    _add_solid_background(slide_title_obj, prs, COLOR_PRIMARY)
    
    # Họa tiết trang trí Accent Bar
    accent_bar = slide_title_obj.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, Inches(1.2), Inches(2.2), Inches(0.15), Inches(3.2)
    )
    accent_bar.fill.solid()
    accent_bar.fill.fore_color.rgb = COLOR_ACCENT
    accent_bar.line.fill.background()
    
    # Khung text Tiêu đề + Phụ đề
    tb = slide_title_obj.shapes.add_textbox(Inches(1.6), Inches(2.0), Inches(10.5), Inches(3.5))
    tf = tb.text_frame
    tf.word_wrap = True
    
    # Tiêu đề chính
    p_title = tf.paragraphs[0]
    p_title.text = data.get("title", "BÁO CÁO THUYẾT TRÌNH").upper()
    p_title.font.name = "Segoe UI"
    p_title.font.size = Pt(36)
    p_title.font.bold = True
    p_title.font.color.rgb = COLOR_WHITE
    p_title.space_after = Pt(14)
    
    # Phụ đề
    subtitle = data.get("subtitle", "")
    if subtitle:
        p_sub = tf.add_paragraph()
        p_sub.text = subtitle
        p_sub.font.name = "Segoe UI"
        p_sub.font.size = Pt(20)
        p_sub.font.color.rgb = RGBColor(0xBA, 0xE6, 0xFD) # Light Sky Blue
        p_sub.space_after = Pt(20)
        
    # Người thuyết trình / Ngày tháng
    presenter = data.get("presenter", "Phát triển bởi Chatbot Office AI")
    p_pres = tf.add_paragraph()
    p_pres.text = presenter
    p_pres.font.name = "Segoe UI"
    p_pres.font.size = Pt(13)
    p_pres.font.color.rgb = RGBColor(0x94, 0xA3, 0xB8)

    # ----------------------------------------------------
    # CÁC SLIDE NỘI DUNG (CONTENT SLIDES)
    # ----------------------------------------------------
    slides_list = data.get("slides", [])
    for s_idx, s_info in enumerate(slides_list, 1):
        slide = prs.slides.add_slide(blank_layout)
        _add_solid_background(slide, prs, COLOR_LIGHT_BG)
        
        # Header Slide: Dải nền trắng trên đầu
        hdr_bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, Inches(1.4))
        hdr_bg.fill.solid()
        hdr_bg.fill.fore_color.rgb = COLOR_WHITE
        hdr_bg.line.fill.background()
        
        # Đường kẻ viền xanh phân cách header
        line_div = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, Inches(1.38), prs.slide_width, Inches(0.04))
        line_div.fill.solid()
        line_div.fill.fore_color.rgb = COLOR_SECONDARY
        line_div.line.fill.background()
        
        # Tiêu đề Slide
        tb_hdr = slide.shapes.add_textbox(Inches(1.0), Inches(0.35), Inches(11.3), Inches(0.8))
        tf_hdr = tb_hdr.text_frame
        p_hdr = tf_hdr.paragraphs[0]
        p_hdr.text = s_info.get("title", f"Nội Dung {s_idx}")
        p_hdr.font.name = "Segoe UI"
        p_hdr.font.size = Pt(24)
        p_hdr.font.bold = True
        p_hdr.font.color.rgb = COLOR_PRIMARY
        
        # Số trang slide ở góc dưới
        tb_foot = slide.shapes.add_textbox(Inches(11.5), Inches(6.8), Inches(1.2), Inches(0.4))
        p_foot = tb_foot.text_frame.paragraphs[0]
        p_foot.text = f"{s_idx + 1} / {len(slides_list) + 2}"
        p_foot.alignment = PP_ALIGN.RIGHT
        p_foot.font.name = "Segoe UI"
        p_foot.font.size = Pt(11)
        p_foot.font.color.rgb = COLOR_MUTED_TEXT

        # Nội dung chính (Bullets / Cards)
        bullets = s_info.get("bullets", [])
        table_info = s_info.get("table")
        
        if table_info:
            # Render Bảng biểu trong Slide
            headers = table_info.get("headers", [])
            rows = table_info.get("rows", [])
            if headers or rows:
                col_cnt = len(headers) if headers else len(rows[0])
                row_cnt = len(rows) + (1 if headers else 0)
                
                left = Inches(1.0)
                top = Inches(2.0)
                width = Inches(11.3)
                height = Inches(min(row_cnt * 0.6, 4.5))
                
                table_shape = slide.shapes.add_table(row_cnt, col_cnt, left, top, width, height)
                table = table_shape.table
                
                cur_r = 0
                if headers:
                    for c_idx, h_text in enumerate(headers):
                        c = table.cell(cur_r, c_idx)
                        c.fill.solid()
                        c.fill.fore_color.rgb = COLOR_PRIMARY
                        p = c.text_frame.paragraphs[0]
                        p.text = str(h_text)
                        p.font.name = "Segoe UI"
                        p.font.bold = True
                        p.font.size = Pt(13)
                        p.font.color.rgb = COLOR_WHITE
                        p.alignment = PP_ALIGN.CENTER
                    cur_r += 1
                    
                for r_idx, r_data in enumerate(rows):
                    bg_col = RGBColor(0xEE, 0xF2, 0xF6) if r_idx % 2 == 1 else COLOR_WHITE
                    for c_idx, val in enumerate(r_data):
                        if c_idx < col_cnt:
                            c = table.cell(cur_r, c_idx)
                            c.fill.solid()
                            c.fill.fore_color.rgb = bg_col
                            p = c.text_frame.paragraphs[0]
                            p.text = str(val)
                            p.font.name = "Segoe UI"
                            p.font.size = Pt(12)
                            p.font.color.rgb = COLOR_DARK_TEXT
                    cur_r += 1
        elif bullets:
            # Render Khung Bullets nền trắng đổ bóng nhẹ
            card_shape = slide.shapes.add_shape(
                MSO_SHAPE.ROUNDED_RECTANGLE, Inches(1.0), Inches(1.8), Inches(11.3), Inches(4.7)
            )
            card_shape.fill.solid()
            card_shape.fill.fore_color.rgb = COLOR_WHITE
            card_shape.line.color.rgb = RGBColor(0xE2, 0xE8, 0xF0)
            
            tb_body = slide.shapes.add_textbox(Inches(1.4), Inches(2.1), Inches(10.5), Inches(4.1))
            tf_body = tb_body.text_frame
            tf_body.word_wrap = True
            
            for b_idx, b_text in enumerate(bullets):
                p_bullet = tf_body.paragraphs[0] if b_idx == 0 else tf_body.add_paragraph()
                p_bullet.text = f"•  {b_text}"
                p_bullet.font.name = "Segoe UI"
                p_bullet.font.size = Pt(16)
                p_bullet.font.color.rgb = COLOR_DARK_TEXT
                p_bullet.space_after = Pt(14)
                p_bullet.line_spacing = 1.25

        # Ghi chú diễn giả (Speaker Notes)
        notes_text = s_info.get("notes")
        if notes_text and slide.notes_slide:
            slide.notes_slide.notes_text_frame.text = str(notes_text)

    # ----------------------------------------------------
    # SLIDE CUỐI CÙNG: CẢM ƠN (CONCLUSION SLIDE)
    # ----------------------------------------------------
    slide_end = prs.slides.add_slide(blank_layout)
    _add_solid_background(slide_end, prs, COLOR_PRIMARY)
    
    tb_end = slide_end.shapes.add_textbox(Inches(2.0), Inches(2.6), Inches(9.3), Inches(2.5))
    tf_end = tb_end.text_frame
    p_end = tf_end.paragraphs[0]
    p_end.text = "XIN CHÂN THÀNH CẢM ƠN!"
    p_end.alignment = PP_ALIGN.CENTER
    p_end.font.name = "Segoe UI"
    p_end.font.size = Pt(36)
    p_end.font.bold = True
    p_end.font.color.rgb = COLOR_WHITE
    p_end.space_after = Pt(14)
    
    p_qa = tf_end.add_paragraph()
    p_qa.text = "Hỏi & Đáp (Q & A)"
    p_qa.alignment = PP_ALIGN.CENTER
    p_qa.font.name = "Segoe UI"
    p_qa.font.size = Pt(18)
    p_qa.font.color.rgb = RGBColor(0x93, 0xC5, 0xFD)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    prs.save(output_path)
    return output_path


from .utils import robust_extract_json, clean_raw_llm_text

def build_pptx_from_markdown(markdown_text: str, output_path: str, title: str = "") -> str:
    """
    Chuyển đổi bài thuyết trình dạng Markdown từ LLM sang file PowerPoint (.pptx).
    Mỗi tiêu đề '# ' hoặc '## ' biểu thị một slide mới.
    Nếu văn bản truyền vào thực chất là cấu trúc JSON, tự động phân tích và dùng build_pptx_from_data.
    """
    parsed_json = robust_extract_json(markdown_text)
    if parsed_json and isinstance(parsed_json, dict) and "slides" in parsed_json:
        return build_pptx_from_data(parsed_json, output_path)

    slides = []
    lines = clean_raw_llm_text(markdown_text).split("\n")
    cur_slide = None
    doc_title = title or "BÀI THUYẾT TRÌNH"
    subtitle = ""
    
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
            
        if stripped.startswith("# "):
            if not doc_title or doc_title == "BÀI THUYẾT TRÌNH":
                doc_title = stripped[2:].strip()
            else:
                if cur_slide:
                    slides.append(cur_slide)
                cur_slide = {"title": stripped[2:].strip(), "bullets": []}
        elif stripped.startswith("## "):
            if cur_slide:
                slides.append(cur_slide)
            cur_slide = {"title": stripped[3:].strip(), "bullets": []}
        elif stripped.startswith("- ") or stripped.startswith("* "):
            bullet_text = stripped[2:].strip()
            if cur_slide is None:
                cur_slide = {"title": "Nội Dung", "bullets": []}
            cur_slide["bullets"].append(bullet_text)
        elif stripped.startswith("Ghi chú:") or stripped.startswith("Notes:"):
            if cur_slide:
                cur_slide["notes"] = stripped
        elif not cur_slide and not subtitle:
            subtitle = stripped
            
    if cur_slide:
        slides.append(cur_slide)
        
    data = {
        "title": doc_title,
        "subtitle": subtitle,
        "slides": slides
    }
    return build_pptx_from_data(data, output_path)
