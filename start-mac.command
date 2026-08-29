#!/bin/bash
cd "$(dirname "$0")"

if [ ! -f ".venv/bin/python" ]; then
  echo "エラー: .venv が見つかりません。"
  exit 1
fi

echo "PDF OCR サーバーを起動しています..."
open http://127.0.0.1:8000
.venv/bin/python app.py
