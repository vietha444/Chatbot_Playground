"""
Module tạo và định dạng bảng tính Microsoft Excel (.xlsx) chuyên nghiệp
Hỗ trợ công thức tính toán tự động, định dạng số, tiền tệ, màu sắc và tự động căn chỉnh độ rộng cột.
"""
import os
import re
from typing import Dict, Any, List, Optional
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

# Bảng màu chuẩn
HEADER_FILL = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid") # Xanh Navy đậm
HEADER_FONT = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
TITLE_FONT = Font(name="Calibri", size=16, bold=True, color="1E3A8A")
SUBTITLE_FONT = Font(name="Calibri", size=11, italic=True, color="4B5563")
TOTAL_FILL = PatternFill(start_color="E2E8F0", end_color="E2E8F0", fill_type="solid")
TOTAL_FONT = Font(name="Calibri", size=11, bold=True, color="0F172A")
ZEBRA_FILL = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
WHITE_FILL = PatternFill(start_color="FFFFFF", end_color="FFFFFF", fill_type="solid")

THIN_BORDER_SIDE = Side(style="thin", color="CBD5E1")
DOUBLE_BOTTOM_SIDE = Side(style="double", color="334155")
CELL_BORDER = Border(left=THIN_BORDER_SIDE, right=THIN_BORDER_SIDE, top=THIN_BORDER_SIDE, bottom=THIN_BORDER_SIDE)
TOTAL_BORDER = Border(left=THIN_BORDER_SIDE, right=THIN_BORDER_SIDE, top=THIN_BORDER_SIDE, bottom=DOUBLE_BOTTOM_SIDE)

def _parse_cell_value(val_any: Any):
    """Phân tích giá trị chuỗi, chuyển đổi sang số nguyên/thực nếu hợp lệ hoặc giữ công thức"""
    if val_any is None:
        return ""
    if isinstance(val_any, (int, float, bool)):
        return val_any
        
    s = str(val_any).strip()
    if s.startswith("="):
        return s  # Đây là công thức Excel
        
    # Thử parse số nguyên
    if re.match(r'^-?\d+$', s):
        try:
            return int(s)
        except ValueError:
            pass
            
    # Thử parse số thực (hỗ trợ cả dấu chấm và dấu phẩy phân cách)
    # Ví dụ: 1250000 hoặc 1,250,000 hoặc 8.5
    clean_num = s.replace(",", "")
    if re.match(r'^-?\d+\.\d+$', clean_num):
        try:
            return float(clean_num)
        except ValueError:
            pass
            
    return s


def build_excel_from_data(data: Dict[str, Any], output_path: str) -> str:
    """
    Tạo file Excel từ cấu trúc JSON.
    data format:
    {
        "title": "BẢNG KẾ HOẠCH TÀI CHÍNH QUÝ 4/2026",
        "sheets": [
            {
                "sheet_name": "Doanh Thu",
                "headers": ["STT", "Hạng Mục", "Số Lượng", "Đơn Giá (VNĐ)", "Thành Tiền (VNĐ)"],
                "rows": [
                    ["1", "Phần mềm Chatbot RAG", 5, 20000000, "=C4*D4"],
                    ["2", "Dịch vụ Bảo trì", 12, 3000000, "=C5*D5"]
                ],
                "total_row": ["Tổng cộng", "", "=SUM(C4:C5)", "", "=SUM(E4:E5)"],
                "formats": {"D": "currency", "E": "currency"}
            }
        ]
    }
    """
    wb = openpyxl.Workbook()
    # Xóa sheet mặc định ban đầu nếu có nhiều sheet
    sheets_info = data.get("sheets", [])
    if not sheets_info:
        # Nếu data dạng phẳng đơn giản (headers, rows)
        sheets_info = [{
            "sheet_name": data.get("sheet_name", "Sheet1"),
            "headers": data.get("headers", []),
            "rows": data.get("rows", []),
            "total_row": data.get("total_row")
        }]
        
    first_sheet = True
    for s_idx, s_info in enumerate(sheets_info):
        sheet_name = s_info.get("sheet_name", f"Sheet{s_idx + 1}")
        if first_sheet:
            ws = wb.active
            ws.title = sheet_name[:31]  # Excel giới hạn 31 ký tự tên sheet
            first_sheet = False
        else:
            ws = wb.create_sheet(title=sheet_name[:31])
            
        ws.views.sheetView[0].showGridLines = True
        
        current_row = 1
        
        # 1. Tiêu đề bảng tính (Nếu có)
        doc_title = s_info.get("title") or data.get("title")
        if doc_title:
            ws.cell(row=current_row, column=1, value=doc_title)
            ws.cell(row=current_row, column=1).font = TITLE_FONT
            ws.row_dimensions[current_row].height = 28
            current_row += 1
            
        subtitle = s_info.get("subtitle") or data.get("subtitle")
        if subtitle:
            ws.cell(row=current_row, column=1, value=subtitle)
            ws.cell(row=current_row, column=1).font = SUBTITLE_FONT
            current_row += 1
            
        if doc_title or subtitle:
            current_row += 1 # Dòng trống phân cách
            
        headers = s_info.get("headers", [])
        rows = s_info.get("rows", [])
        total_row = s_info.get("total_row")
        col_count = len(headers) if headers else (len(rows[0]) if rows else 1)
        
        # 2. Dòng Headers
        header_row_idx = current_row
        if headers:
            ws.row_dimensions[header_row_idx].height = 24
            for c_idx, h_text in enumerate(headers, 1):
                cell = ws.cell(row=header_row_idx, column=c_idx, value=str(h_text))
                cell.fill = HEADER_FILL
                cell.font = HEADER_FONT
                cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
                cell.border = CELL_BORDER
            current_row += 1
            
        # 3. Dữ liệu Rows
        formats = s_info.get("formats", {})
        for r_idx, r_data in enumerate(rows):
            ws.row_dimensions[current_row].height = 20
            is_even = (r_idx % 2 == 1)
            row_fill = ZEBRA_FILL if is_even else WHITE_FILL
            
            for c_idx, val in enumerate(r_data, 1):
                cell = ws.cell(row=current_row, column=c_idx)
                parsed_val = _parse_cell_value(val)
                cell.value = parsed_val
                cell.fill = row_fill
                cell.border = CELL_BORDER
                
                # Căn lề và định dạng
                col_letter = get_column_letter(c_idx)
                fmt_type = formats.get(col_letter) or formats.get(str(c_idx))
                
                if isinstance(parsed_val, (int, float)):
                    if fmt_type == "currency" or "tiền" in (headers[c_idx-1].lower() if c_idx-1 < len(headers) else ""):
                        cell.number_format = '#,##0 "₫"'
                        cell.alignment = Alignment(horizontal="right", vertical="center")
                    elif fmt_type == "percent" or "%" in (headers[c_idx-1] if c_idx-1 < len(headers) else ""):
                        cell.number_format = '0.0%'
                        cell.alignment = Alignment(horizontal="right", vertical="center")
                    else:
                        cell.number_format = '#,##0' if isinstance(parsed_val, int) else '#,##0.00'
                        cell.alignment = Alignment(horizontal="right", vertical="center")
                elif str(parsed_val).startswith("="):
                    cell.alignment = Alignment(horizontal="right", vertical="center")
                    if "tiền" in (headers[c_idx-1].lower() if c_idx-1 < len(headers) else ""):
                        cell.number_format = '#,##0 "₫"'
                elif len(str(parsed_val)) <= 4 or (c_idx == 1 and "stt" in (headers[0].lower() if headers else "")):
                    cell.alignment = Alignment(horizontal="center", vertical="center")
                else:
                    cell.alignment = Alignment(horizontal="left", vertical="center")
                    
            current_row += 1
            
        # 4. Dòng Tổng cộng (Total Row nếu có)
        if total_row:
            ws.row_dimensions[current_row].height = 22
            for c_idx, val in enumerate(total_row, 1):
                cell = ws.cell(row=current_row, column=c_idx)
                parsed_val = _parse_cell_value(val)
                cell.value = parsed_val
                cell.fill = TOTAL_FILL
                cell.font = TOTAL_FONT
                cell.border = TOTAL_BORDER
                
                if isinstance(parsed_val, (int, float)) or str(parsed_val).startswith("="):
                    cell.alignment = Alignment(horizontal="right", vertical="center")
                    if "tiền" in (headers[c_idx-1].lower() if c_idx-1 < len(headers) else ""):
                        cell.number_format = '#,##0 "₫"'
                else:
                    cell.alignment = Alignment(horizontal="left" if c_idx > 1 else "center", vertical="center")
            current_row += 1

        # 5. Tự động điều chỉnh độ rộng cột (Auto-fit Column Width)
        for col in ws.columns:
            max_len = 0
            col_letter = get_column_letter(col[0].column)
            for cell in col:
                # Bỏ qua dòng tiêu đề chính khi tính độ rộng
                if cell.row < header_row_idx:
                    continue
                if cell.value:
                    val_str = str(cell.value)
                    # Nếu là công thức, dự trù độ dài số trung bình ~12 ký tự
                    if val_str.startswith("="):
                        val_str = "123,456,789 ₫"
                    max_len = max(max_len, len(val_str))
            ws.column_dimensions[col_letter].width = max(max_len + 4, 12)
            
        # 6. Bật bộ lọc AutoFilter cho header
        if headers:
            last_col_letter = get_column_letter(col_count)
            ws.auto_filter.ref = f"A{header_row_idx}:{last_col_letter}{current_row - 1}"

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    wb.save(output_path)
    return output_path


from .utils import robust_extract_json, clean_raw_llm_text

def build_excel_from_markdown(markdown_text: str, output_path: str, title: str = "BẢNG DỮ LIỆU EXCEL") -> str:
    """
    Chuyển đổi bảng Markdown từ đầu ra LLM thành file Excel (.xlsx).
    Nếu văn bản truyền vào thực chất là cấu trúc JSON, tự động phân tích và dùng build_excel_from_data.
    """
    parsed_json = robust_extract_json(markdown_text)
    if parsed_json and isinstance(parsed_json, dict) and ("sheets" in parsed_json or "headers" in parsed_json):
        return build_excel_from_data(parsed_json, output_path)

    lines = [l.strip() for l in clean_raw_llm_text(markdown_text).split("\n") if l.strip()]
    table_lines = [l for l in lines if l.startswith("|") and l.endswith("|")]
    
    if not table_lines:
        # Fallback tạo bảng 1 cột nếu không tìm thấy bảng markdown
        data = {
            "title": title,
            "sheets": [{
                "sheet_name": "Nội Dung",
                "headers": ["Nội Dung"],
                "rows": [[l] for l in lines]
            }]
        }
        return build_excel_from_data(data, output_path)
        
    rows_data = []
    for line in table_lines:
        cells = [c.strip() for c in line.strip("|").split("|")]
        # Bỏ qua dòng phân cách |---|---|
        if all(re.match(r'^-+$', c) for c in cells):
            continue
        rows_data.append(cells)
        
    if not rows_data:
        headers = ["Cột 1"]
        body_rows = []
    else:
        headers = rows_data[0]
        body_rows = rows_data[1:]
        
    data = {
        "title": title,
        "sheets": [{
            "sheet_name": "Bảng Tính",
            "headers": headers,
            "rows": body_rows
        }]
    }
    return build_excel_from_data(data, output_path)
