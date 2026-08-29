# PDF OCR to Text — プログラム仕様書

## 1. 概要

| 項目 | 内容 |
|------|------|
| プロジェクト名 | my-first-app |
| 機能 | スキャンしたPDF（画像ベースPDF）をOCRでテキストに変換 |
| 提供形態 | Webアプリ（メイン） / CLI（サブ） |
| 想定利用環境 | macOS / Windows 10 以上 |
| 想定クライアント | Chrome などのデスクトップブラウザ |
| リポジトリ | https://github.com/yossaeki-beep/my-first-app |
| ブランチ | `cursor/pdf-ocr-to-text-a59d` |

---

## 2. 目的

- 紙文書をスキャンして作成した PDF から、テキストを抽出する
- ブラウザ上で PDF をアップロードし、変換結果を表示・ダウンロードできるようにする
- **個人情報を含む文書**を扱うため、処理は **ローカル PC 内** で完結させる（外部サーバーへ送信しない）

---

## 3. システム構成

```
┌─────────────────────────────────────────────────────┐
│  ブラウザ (Chrome)                                   │
│  http://127.0.0.1:8000                              │
│  ┌─────────────┐    fetch POST     ┌──────────────┐ │
│  │ index.html  │ ────────────────→ │  app.py      │ │
│  │ app.js      │ ←──────────────── │  (FastAPI)   │ │
│  └─────────────┘    JSON response └──────┬───────┘ │
└──────────────────────────────────────────│─────────┘
                                           │
                                           ▼
                                  ┌─────────────────┐
                                  │  ocr_core.py    │
                                  │  PyMuPDF        │
                                  │  → 画像化       │
                                  │  Tesseract OCR  │
                                  └─────────────────┘
```

### 3.1 処理フロー

1. ユーザーが PDF をブラウザからアップロード
2. FastAPI が PDF バイナリを受信
3. PyMuPDF が各ページを画像（ビットマップ）に変換
4. Tesseract OCR が画像から文字を認識
5. ページ区切り付きテキストを JSON で返却
6. ブラウザが結果を表示し、`.txt` としてダウンロード可能

---

## 4. ファイル構成

```
my-first-app/
├── app.py                 # Webサーバー（FastAPI）
├── ocr_core.py            # OCR共通ロジック
├── pdf_to_text.py         # CLI版
├── requirements.txt       # Python依存関係
├── README.md              # セットアップ手順
├── docs/
│   └── obsidian/
│       ├── PDF-OCR-Mac版セットアップ手順.md
│       └── PDF-OCR-Windows版セットアップ手順.md
└── static/
    ├── index.html         # ブラウザUI
    ├── style.css          # スタイル
    └── app.js             # フロントエンド処理
```

---

## 5. モジュール仕様

### 5.1 `ocr_core.py` — OCRコア

| 関数 | 説明 |
|------|------|
| `configure_tesseract()` | OS に応じて Tesseract 実行ファイルのパスを設定 |
| `render_page(page, dpi)` | PDF 1ページを PIL 画像に変換 |
| `ocr_pdf_bytes(pdf_bytes, lang, dpi)` | PDF バイナリを OCR しテキストを返す |
| `ocr_pdf_file(pdf_path, lang, dpi)` | PDF ファイルパスを指定して OCR |

**定数**

| 定数 | 既定値 | 説明 |
|------|--------|------|
| `DEFAULT_LANG` | `jpn+eng` | Tesseract 言語（日本語+英語） |
| `DEFAULT_DPI` | `300` | ページ画像化の解像度 |

**Windows 対応**

- PATH に `tesseract` が無い場合、以下を自動検索:
  - `C:\Program Files\Tesseract-OCR\tesseract.exe`
  - `C:\Program Files (x86)\Tesseract-OCR\tesseract.exe`

**出力形式**

```text
--- ページ 1 ---
（1ページ目のテキスト）

--- ページ 2 ---
（2ページ目のテキスト）
```

---

### 5.2 `app.py` — Webサーバー

**フレームワーク:** FastAPI + Uvicorn

**起動**

```bash
python app.py
```

- ホスト: `127.0.0.1`（ローカルのみ）
- ポート: `8000`

#### API エンドポイント

| メソッド | パス | 説明 |
|----------|------|------|
| `GET` | `/` | ブラウザ UI（HTML）を返す |
| `GET` | `/health` | サーバー稼働確認 `{ "status": "ok" }` |
| `POST` | `/api/convert` | PDF を OCR 変換 |

#### `POST /api/convert`

**リクエスト（multipart/form-data）**

| パラメータ | 型 | 必須 | 既定値 | 説明 |
|------------|-----|------|--------|------|
| `file` | ファイル | ✅ | — | PDF ファイル |
| `lang` | 文字列 | — | `jpn+eng` | Tesseract 言語指定 |
| `dpi` | 整数 | — | `300` | 画像化解像度（72〜600） |

**制約**

- ファイル形式: `.pdf` のみ
- 最大サイズ: **50MB**
- DPI 範囲: **72〜600**

**成功レスポンス（200）**

```json
{
  "filename": "document.txt",
  "text": "--- ページ 1 ---\n...",
  "page_count": 3
}
```

**エラーレスポンス**

| HTTP | 内容 |
|------|------|
| 400 | PDF 以外、空ファイル、サイズ超過、DPI 範囲外 |
| 500 | OCR 処理失敗（Tesseract 未インストール等） |

---

### 5.3 `pdf_to_text.py` — CLI版

**用途:** ターミナル / PowerShell から PDF を変換

**基本用法**

```bash
python pdf_to_text.py document.pdf
```

**オプション**

| オプション | 説明 |
|------------|------|
| `-o, --output` | 出力先（ファイルまたはディレクトリ） |
| `-l, --lang` | 言語（既定: `jpn+eng`） |
| `--dpi` | 解像度（既定: `300`） |

**例**

```bash
# 単一ファイル
python pdf_to_text.py document.pdf

# 出力先指定
python pdf_to_text.py document.pdf -o output/result.txt

# ディレクトリ一括
python pdf_to_text.py scans/ -o output/
```

---

### 5.4 `static/` — フロントエンド

#### `index.html`

- PDF ドラッグ＆ドロップ UI
- 言語選択: `jpn+eng` / `jpn` / `eng`
- DPI 選択: 200 / 300 / 400
- 変換結果の表示と `.txt` ダウンロード

#### `app.js`

- `/api/convert` へ `fetch` で POST
- エラー時は `error.message` を画面に表示（例: `Failed to fetch` = サーバー未接続）

---

## 6. 外部依存

### 6.1 システム要件

| ソフトウェア | 用途 |
|--------------|------|
| Python 3.12〜3.14 | 実行環境 |
| Tesseract OCR 5.x | OCR エンジン |
| Tesseract 言語データ | `jpn`（日本語）、`eng`（英語） |

### 6.2 Python パッケージ（`requirements.txt`）

| パッケージ | 用途 |
|------------|------|
| `pymupdf` | PDF 読み込み・ページ画像化 |
| `pytesseract` | Tesseract の Python ラッパー |
| `Pillow` | 画像処理 |
| `fastapi` | Web API フレームワーク |
| `uvicorn` | ASGI サーバー |
| `python-multipart` | ファイルアップロード処理 |

---

## 7. セキュリティ・機密性

| 項目 | 仕様 |
|------|------|
| 通信先 | `127.0.0.1` のみ（ローカルホスト） |
| データ送信 | 外部サーバーへ送信しない |
| クラウド公開 | 非推奨（個人情報保護のため） |
| ngrok / トンネル | 非推奨 |
| アップロード上限 | 50MB |
| 一時ファイル | ディスク上に永続保存しない（メモリ上で処理） |

---

## 8. 制限事項

| 項目 | 内容 |
|------|------|
| 対象 PDF | スキャン画像ベースの PDF（OCR が必要なもの） |
| テキスト PDF | テキストレイヤー付き PDF でも OCR 処理される（非効率） |
| 表・レイアウト | 複雑なレイアウトはテキスト順序が崩れることがある |
| 手書き文字 | 認識精度が低い |
| モバイル | iPhone 等は非対象（デスクトップブラウザ想定） |
| 同時利用 | 単一ユーザー・単一プロセス想定（本番向けスケーリングなし） |

---

## 9. 対応 OS とセットアップ

| OS | Tesseract インストール | 起動コマンド |
|----|------------------------|--------------|
| macOS | `brew install tesseract tesseract-lang` | `python app.py` |
| Windows 10/11 LTSC | UB Mannheim 版インストーラ + `jpn.traineddata` | `python app.py` |

詳細手順は `docs/obsidian/` 内の Markdown を参照。

---

## 10. トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| `Failed to fetch` | サーバー未起動 / URL 誤り | `python app.py` を起動、`http://127.0.0.1:8000` を開く |
| `tesseract is not installed` | Tesseract 未インストール | OS 別手順でインストール |
| 日本語が読めない | `jpn.traineddata` 不足 | tessdata フォルダに配置 |
| `Operation not permitted` (Mac) | フォルダ権限 | `~/my-first-app` 等に移動 |
| PowerShell 実行拒否 (Win) | 実行ポリシー | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |

---

## 11. バージョン履歴

| 日付 | 内容 |
|------|------|
| 2026-08-28 | CLI版（`pdf_to_text.py`）追加 |
| 2026-08-28 | Web UI（FastAPI + ブラウザ）追加 |
| 2026-08-28 | Windows 対応・Tesseract 自動検出 |
| 2026-08-28 | Obsidian 向け Mac/Windows 手順書追加 |

---

## 12. 関連ドキュメント

- [[PDF-OCR-Mac版セットアップ手順]]
- [[PDF-OCR-Windows版セットアップ手順]]
- `README.md`
