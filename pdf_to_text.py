#!/usr/bin/env python3
"""スキャンPDFをOCRでテキストファイルに変換するCLIツール。"""

from __future__ import annotations

import argparse
import sys
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


def ocr_pdf(pdf_path: Path, lang: str, dpi: int) -> str:
    """PDFの全ページをOCRし、ページ区切り付きのテキストを返す。"""
    pages_text: list[str] = []

    with pymupdf.open(pdf_path) as doc:
        for page_number, page in enumerate(doc, start=1):
            image = render_page(page, dpi)
            text = pytesseract.image_to_string(image, lang=lang)
            pages_text.append(f"--- ページ {page_number} ---\n{text.rstrip()}")

    return "\n\n".join(pages_text) + "\n"


def resolve_output_path(input_path: Path, output: Path | None) -> Path:
    """出力ファイルパスを決定する。"""
    if output is None:
        return input_path.with_suffix(".txt")

    if output.is_dir() or str(output).endswith("/"):
        return output / f"{input_path.stem}.txt"

    return output


def convert_file(input_path: Path, output: Path | None, lang: str, dpi: int) -> Path:
    """1つのPDFを変換する。"""
    if not input_path.is_file():
        raise FileNotFoundError(f"ファイルが見つかりません: {input_path}")
    if input_path.suffix.lower() != ".pdf":
        raise ValueError(f"PDFファイルを指定してください: {input_path}")

    output_path = resolve_output_path(input_path, output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    text = ocr_pdf(input_path, lang=lang, dpi=dpi)
    output_path.write_text(text, encoding="utf-8")
    return output_path


def collect_pdf_paths(inputs: list[str]) -> list[Path]:
    """入力パスから変換対象のPDF一覧を収集する。"""
    pdf_paths: list[Path] = []

    for raw_path in inputs:
        path = Path(raw_path)

        if path.is_dir():
            pdf_paths.extend(sorted(path.glob("*.pdf")))
            pdf_paths.extend(sorted(path.glob("*.PDF")))
            continue

        pdf_paths.append(path)

    unique_paths: list[Path] = []
    seen: set[Path] = set()
    for path in pdf_paths:
        resolved = path.resolve()
        if resolved not in seen:
            seen.add(resolved)
            unique_paths.append(path)

    return unique_paths


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="スキャンしたPDFをOCRでテキストファイルに変換します。",
    )
    parser.add_argument(
        "inputs",
        nargs="+",
        help="変換するPDFファイル、またはPDFを含むディレクトリ",
    )
    parser.add_argument(
        "-o",
        "--output",
        help="出力先（ファイルまたはディレクトリ）。省略時は入力と同じ場所に .txt を作成",
    )
    parser.add_argument(
        "-l",
        "--lang",
        default=DEFAULT_LANG,
        help=f"Tesseractの言語指定（既定: {DEFAULT_LANG}）",
    )
    parser.add_argument(
        "--dpi",
        type=int,
        default=DEFAULT_DPI,
        help=f"OCR用のレンダリング解像度（既定: {DEFAULT_DPI}）",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        pdf_paths = collect_pdf_paths(args.inputs)
    except Exception as exc:
        print(f"エラー: {exc}", file=sys.stderr)
        return 1

    if not pdf_paths:
        print("エラー: 変換対象のPDFが見つかりませんでした。", file=sys.stderr)
        return 1

    output = Path(args.output) if args.output else None
    if output and len(pdf_paths) > 1 and not output.is_dir() and not str(output).endswith("/"):
        print(
            "エラー: 複数PDFを変換する場合、--output にはディレクトリを指定してください。",
            file=sys.stderr,
        )
        return 1

    had_error = False
    for pdf_path in pdf_paths:
        try:
            output_path = convert_file(
                pdf_path,
                output=output,
                lang=args.lang,
                dpi=args.dpi,
            )
            print(f"変換完了: {pdf_path} -> {output_path}")
        except Exception as exc:
            had_error = True
            print(f"エラー ({pdf_path}): {exc}", file=sys.stderr)

    return 1 if had_error else 0


if __name__ == "__main__":
    raise SystemExit(main())
