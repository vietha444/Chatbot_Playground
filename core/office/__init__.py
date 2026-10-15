"""
Gói Office Studio AI - Tạo, Chỉnh Sửa và Đánh Giá Tài Liệu Văn Phòng
"""
from .office_service import OfficeService
from .parsers import extract_any_document
from .docx_builder import build_docx_from_data, build_docx_from_markdown
from .excel_builder import build_excel_from_data, build_excel_from_markdown
from .pptx_builder import build_pptx_from_data, build_pptx_from_markdown
from .evaluator import run_evaluation

__all__ = [
    "OfficeService",
    "extract_any_document",
    "build_docx_from_data",
    "build_docx_from_markdown",
    "build_excel_from_data",
    "build_excel_from_markdown",
    "build_pptx_from_data",
    "build_pptx_from_markdown",
    "run_evaluation"
]
