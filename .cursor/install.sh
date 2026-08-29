#!/usr/bin/env bash
# Cloud Agent 用の依存関係セットアップ（冪等）。
# システム依存（Tesseract OCR + 日本語/英語データ）と Python 仮想環境を用意する。
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

# OCR エンジンと言語データ（jpn+eng）をインストール。
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  tesseract-ocr \
  tesseract-ocr-jpn \
  tesseract-ocr-eng \
  python3-venv

# プロジェクト用の Python 仮想環境（.gitignore 済み）。
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi

.venv/bin/python -m pip install --upgrade pip
.venv/bin/pip install -r requirements.txt

echo "セットアップ完了: $(.venv/bin/python --version), $(tesseract --version 2>&1 | head -1)"
