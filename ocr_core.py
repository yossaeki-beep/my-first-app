"""スキャンPDFのOCR変換コアロジック。"""

from __future__ import annotations

from pathlib import Path

import pymupdf
import pytesseract
from PIL import Image

DEFAULT_LANG = "jpn+eng"
DEFAULT_DPI = 300


def render_page(page: pymupdf.Page, dpi: int) -> Image.Image:
    """PDFページをPIL画像に変換する。"""
    zoom = dpi / 72
    matrix = pymupdf.Matrix(zoom, zoom)
    pixmap = page.get_pixmap(matrix=matrix, alpha=False)
    return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)


def ocr_pdf_bytes(pdf_bytes: bytes, lang: str = DEFAULT_LANG, dpi: int = DEFAULT_DPI) -> str:
    """PDFバイナリの全ページをOCRし、ページ区切り付きのテキストを返す。"""
    pages_text: list[str] = []

    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as doc:
        for page_number, page in enumerate(doc, start=1):
            image = render_page(page, dpi)
            text = pytesseract.image_to_string(image, lang=lang)
            pages_text.append(f"--- ページ {page_number} ---\n{text.rstrip()}")

    return "\n\n".join(pages_text) + "\n"


def ocr_pdf_file(pdf_path: Path, lang: str = DEFAULT_LANG, dpi: int = DEFAULT_DPI) -> str:
    """PDFファイルの全ページをOCRする。"""
    return ocr_pdf_bytes(pdf_path.read_bytes(), lang=lang, dpi=dpi)
