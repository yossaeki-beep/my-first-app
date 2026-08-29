#!/usr/bin/env python3
"""スキャンPDFをブラウザからOCR変換するWebアプリ。"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from ocr_core import DEFAULT_DPI, DEFAULT_LANG, ocr_pdf_bytes

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="PDF OCR to Text", version="1.0.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

MAX_UPLOAD_BYTES = 50 * 1024 * 1024


@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    return HTMLResponse((STATIC_DIR / "index.html").read_text(encoding="utf-8"))


@app.post("/api/convert")
async def convert_pdf(
    file: UploadFile = File(...),
    lang: str = Form(DEFAULT_LANG),
    dpi: int = Form(DEFAULT_DPI),
) -> JSONResponse:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="PDFファイルを選択してください。")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="ファイルが空です。")
    if len(pdf_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="ファイルサイズは50MB以下にしてください。")

    if dpi < 72 or dpi > 600:
        raise HTTPException(status_code=400, detail="DPIは72〜600の範囲で指定してください。")

    try:
        text = ocr_pdf_bytes(pdf_bytes, lang=lang, dpi=dpi)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"変換に失敗しました: {exc}") from exc

    stem = Path(file.filename).stem
    return JSONResponse(
        {
            "filename": f"{stem}.txt",
            "text": text,
            "page_count": text.count("--- ページ "),
        }
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=False)
