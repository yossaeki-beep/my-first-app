# PDF OCR to Text — プログラム仕様書 v2.0

> 作成日: 2026-08-29  
> 対象バージョン: ブランチ `cursor/pdf-ocr-to-text-a59d`  
> 前版: `PDF-OCR-プログラム仕様書.md`（v1）

---

## 1. ドキュメント目的

本書は、スキャン PDF を OCR でテキスト化する **my-first-app** の、記述・構成・動作仕様・運用方法を定義する。

v2 では以下を追記・更新した。

- ワンクリック起動（`start.bat` / `start-mac.command`）
- 職場 Windows PC（Windows 10 IoT Enterprise LTSC）での運用
- 個人情報保護を前提とした利用方針
- トラブルシューティング（`Failed to fetch` 等）

---

## 2. システム概要

| 項目 | 内容 |
|------|------|
| プロジェクト名 | my-first-app |
| バージョン | 2.0（仕様書） |
| 主機能 | スキャン PDF の OCR テキスト変換 |
| 提供形態 | Web アプリ（主） / CLI（副） |
| 利用形態 | ローカルホストのみ（`127.0.0.1:8000`） |
| 対応 OS | macOS / Windows 10 以上 |
| 確認済み環境 | macOS（自宅）、Windows 10 IoT Enterprise LTSC（職場） |
| 想定ブラウザ | Google Chrome |
| 非対象 | iPhone / モバイル、クラウド公開、リモートアクセス |

### 2.1 利用シナリオ

| シナリオ | 環境 | 起動方法 |
|----------|------|----------|
| 自宅で変換 | macOS | `start-mac.command` または `python app.py` |
| 職場で変換 | Windows PC | `start.bat` または PowerShell で `python app.py` |
| バッチ処理 | macOS / Windows | `python pdf_to_text.py`（CLI） |

### 2.2 設計方針

1. **ローカル完結** — PDF を外部サーバーへ送信しない  
2. **機密性優先** — 個人情報を含む文書を想定  
3. **シンプルな UI** — ブラウザから PDF をアップロードして変換  
4. **運用の簡便性** — 日常利用はダブルクリック起動（v2 追加）

---

## 3. アーキテクチャ

### 3.1 構成図

```
┌──────────────────────────────────────────────────────────┐
│  利用者 PC（macOS / Windows）                              │
│                                                          │
│  [start.bat / start-mac.command]  ← v2: ワンクリック起動   │
│           │                                              │
│           ▼                                              │
│  ┌─────────────┐   HTTP (127.0.0.1:8000)   ┌──────────┐ │
│  │ Chrome      │ ◄────────────────────────► │ app.py   │ │
│  │ index.html  │   POST /api/convert        │ FastAPI  │ │
│  │ app.js      │                            └────┬─────┘ │
│  └─────────────┘                                 │       │
│                                                  ▼       │
│                                         ┌──────────────┐ │
│                                         │ ocr_core.py  │ │
│                                         │ PyMuPDF      │ │
│                                         │ Tesseract    │ │
│                                         └──────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 3.2 処理シーケンス

```
1. ユーザー → PDF をブラウザにアップロード
2. app.js  → POST /api/convert（multipart/form-data）
3. app.py  → PDF バイナリ受信・検証
4. ocr_core → 各ページを画像化（DPI 指定）
5. ocr_core → Tesseract OCR 実行
6. app.py  → JSON（テキスト + メタデータ）返却
7. app.js  → 画面表示 / .txt ダウンロード
```

---

## 4. ファイル構成

```
my-first-app/
├── app.py                      # Web サーバー（FastAPI）
├── ocr_core.py                 # OCR 共通ロジック
├── pdf_to_text.py              # CLI 版
├── start.bat                   # Windows ワンクリック起動（v2）
├── start-mac.command           # macOS ワンクリック起動（v2）
├── requirements.txt            # Python 依存関係
├── README.md                   # セットアップ・利用手順
├── docs/
│   ├── PDF-OCR-プログラム仕様書.md      # v1 仕様書
│   ├── PDF-OCR-プログラム仕様書-v2.md   # 本書（v2）
│   └── obsidian/
│       ├── PDF-OCR-Mac版セットアップ手順.md
│       └── PDF-OCR-Windows版セットアップ手順.md
└── static/
    ├── index.html              # ブラウザ UI
    ├── style.css               # スタイル
    └── app.js                  # フロントエンド JS
```

---

## 5. モジュール仕様

### 5.1 `ocr_core.py`

**責務:** PDF → 画像 → OCR → テキスト

| シンボル | 種別 | 説明 |
|----------|------|------|
| `DEFAULT_LANG` | 定数 | `jpn+eng` |
| `DEFAULT_DPI` | 定数 | `300` |
| `configure_tesseract()` | 関数 | Tesseract 実行ファイルのパス設定 |
| `render_page(page, dpi)` | 関数 | PDF 1 ページ → PIL 画像 |
| `ocr_pdf_bytes(bytes, lang, dpi)` | 関数 | バイナリ PDF を OCR |
| `ocr_pdf_file(path, lang, dpi)` | 関数 | ファイル PDF を OCR |

**Tesseract パス解決**

| OS | 動作 |
|----|------|
| macOS / Linux | PATH の `tesseract` を使用 |
| Windows | PATH になければ以下を順に検索 |
| | `C:\Program Files\Tesseract-OCR\tesseract.exe` |
| | `C:\Program Files (x86)\Tesseract-OCR\tesseract.exe` |

**出力テキスト形式**

```text
--- ページ 1 ---
（ページ1のOCR結果）

--- ページ 2 ---
（ページ2のOCR結果）
```

---

### 5.2 `app.py`

**責務:** HTTP サーバー、ファイルアップロード受付、OCR 呼び出し

| 設定 | 値 |
|------|-----|
| フレームワーク | FastAPI 0.115+ |
| ASGI サーバー | Uvicorn |
| バインドアドレス | `127.0.0.1` |
| ポート | `8000` |
| 最大アップロード | 50 MB |

#### エンドポイント一覧

| Method | Path | 説明 | レスポンス |
|--------|------|------|------------|
| GET | `/` | Web UI | HTML |
| GET | `/health` | 死活監視 | `{"status":"ok"}` |
| GET | `/static/*` | 静的ファイル | CSS / JS |
| POST | `/api/convert` | PDF OCR 変換 | JSON |

#### POST `/api/convert` 詳細

**Request:** `multipart/form-data`

| フィールド | 型 | 必須 | 既定 | 制約 |
|------------|-----|------|------|------|
| file | file | ✅ | — | `.pdf` のみ、最大 50MB |
| lang | string | — | `jpn+eng` | Tesseract 言語コード |
| dpi | int | — | `300` | 72〜600 |

**Response 200**

```json
{
  "filename": "document.txt",
  "text": "--- ページ 1 ---\n...",
  "page_count": 2
}
```

**Error Responses**

| Status | 条件 | detail 例 |
|--------|------|-----------|
| 400 | PDF 以外 | `PDFファイルを選択してください。` |
| 400 | 空ファイル | `ファイルが空です。` |
| 400 | サイズ超過 | `ファイルサイズは50MB以下にしてください。` |
| 400 | DPI 範囲外 | `DPIは72〜600の範囲で指定してください。` |
| 500 | OCR 失敗 | `変換に失敗しました: ...` |

---

### 5.3 `pdf_to_text.py`（CLI）

**責務:** コマンドラインから PDF を `.txt` に変換

```bash
python pdf_to_text.py INPUT [INPUT ...] [-o OUTPUT] [-l LANG] [--dpi DPI]
```

| 引数 | 説明 |
|------|------|
| `INPUT` | PDF ファイルまたは PDF を含むディレクトリ |
| `-o, --output` | 出力ファイル / ディレクトリ |
| `-l, --lang` | 言語（既定: `jpn+eng`） |
| `--dpi` | 解像度（既定: `300`） |

**出力:** 入力と同じ場所に `.txt` を生成（`-o` 未指定時）

---

### 5.4 フロントエンド（`static/`）

#### UI 要素

| 要素 | 機能 |
|------|------|
| ドロップゾーン | PDF ドラッグ＆ドロップ / ファイル選択 |
| 言語セレクト | `jpn+eng` / `jpn` / `eng` |
| DPI セレクト | 200 / 300 / 400 |
| 変換ボタン | `/api/convert` を呼び出し |
| 結果テキストエリア | OCR 結果表示（読み取り専用） |
| ダウンロードボタン | Blob として `.txt` 保存 |

#### クライアント側制約

- ファイル形式: `.pdf` のみ
- 最大サイズ: 50 MB
- 通信: 同一オリジン `fetch("/api/convert")`

---

## 6. 起動スクリプト仕様（v2 新規）

### 6.1 `start.bat`（Windows）

**目的:** PowerShell 操作なしでサーバー起動 + ブラウザ自動オープン

**動作**

1. スクリプト所在ディレクトリへ移動
2. `.venv\Scripts\python.exe` の存在確認
3. 別ウィンドウで `app.py` を起動（ウィンドウタイトル: `PDF OCR Server`）
4. 3 秒待機
5. 既定ブラウザで `http://127.0.0.1:8000` を開く
6. 案内メッセージ表示

**終了方法:** `PDF OCR Server` ウィンドウを閉じる

**前提条件:** 初回セットアップ済み（`.venv` + `pip install`）

### 6.2 `start-mac.command`（macOS）

**目的:** ダブルクリックでサーバー起動 + ブラウザオープン

**動作**

1. スクリプト所在ディレクトリへ移動
2. `.venv/bin/python` で `app.py` 実行
3. `open http://127.0.0.1:8000` でブラウザ起動

**終了方法:** ターミナルウィンドウを閉じる（Ctrl+C）

---

## 7. 依存関係

### 7.1 システムソフトウェア

| ソフトウェア | バージョン目安 | 用途 |
|--------------|----------------|------|
| Python | 3.12〜3.14（64bit） | 実行環境 |
| Tesseract OCR | 5.x（64bit） | OCR エンジン |
| tessdata | `jpn`, `eng` | 言語データ |

### 7.2 Python パッケージ

| パッケージ | 用途 |
|------------|------|
| pymupdf | PDF 読込・レンダリング |
| pytesseract | Tesseract 連携 |
| Pillow | 画像処理 |
| fastapi | Web API |
| uvicorn | HTTP サーバー |
| python-multipart | ファイルアップロード |

---

## 8. セキュリティ・プライバシー仕様

| 項目 | 仕様 | 備考 |
|------|------|------|
| ネットワーク公開 | **禁止** | `0.0.0.0` バインド不可 |
| リモートアクセス | **非推奨** | ngrok / Cloudflare Tunnel 不使用 |
| クラウドデプロイ | **非推奨** | 個人情報保護のため |
| データ保存 | メモリ処理 | サーバー側に PDF を永続保存しない |
| 通信範囲 | localhost のみ | `127.0.0.1:8000` |
| 同時利用 | 単一ユーザー想定 | 認証機能なし |

---

## 9. 非機能要件・制限

| カテゴリ | 内容 |
|----------|------|
| 性能 | ページ数・DPI に比例して処理時間増加 |
| 精度 | スキャン品質・字体・傾きに依存 |
| レイアウト | 表・多段組は崩れうる |
| 手書き | 非推奨（精度低） |
| 可用性 | PC 起動中かつサーバー実行中のみ |
| スケーラビリティ | なし（個人利用向け） |

---

## 10. 運用手順

### 10.1 初回セットアップ

詳細は `docs/obsidian/` 内の OS 別手順書を参照。

### 10.2 日常起動（Windows）

```
start.bat をダブルクリック
  → Chrome 自動起動
  → PDF 変換
  → 終了時は「PDF OCR Server」窓を閉じる
```

### 10.3 日常起動（macOS）

```
start-mac.command をダブルクリック
  → Chrome 自動起動
  → PDF 変換
  → 終了時はターミナルを閉じる
```

### 10.4 代替（CLI）

Web UI が使えない場合:

```powershell
python pdf_to_text.py C:\path\to\file.pdf
```

---

## 11. トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| `Failed to fetch` | サーバー未起動 / URL 誤り | `start.bat` または `python app.py` を実行。`http://127.0.0.1:8000` を確認 |
| `/health` が開けない | サーバー停止 | 起動スクリプトを再実行 |
| `tesseract is not installed` | Tesseract 未導入 | OS 別手順でインストール |
| 日本語不可 | `jpn.traineddata` 不足 | tessdata フォルダに配置 |
| `Operation not permitted` (Mac) | フォルダ権限 | `~/my-first-app` 等へ移動 |
| PowerShell 実行拒否 (Win) | ExecutionPolicy | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `.venv が見つかりません` (bat) | 未セットアップ | venv 作成 + pip install |

---

## 12. 変更履歴

| 日付 | 版 | 変更内容 |
|------|-----|----------|
| 2026-08-28 | 1.0 | 初版仕様書、CLI / Web UI 追加 |
| 2026-08-28 | 1.1 | Windows 対応、Obsidian 手順書 |
| 2026-08-29 | 1.2 | 職場 Windows（LTSC）での動作確認 |
| 2026-08-29 | **2.0** | 本書。`start.bat` / `start-mac.command`、運用手順・トラブルシューティング更新 |

---

## 13. 関連ドキュメント

| ファイル | 内容 |
|----------|------|
| `README.md` | クイックスタート |
| `docs/PDF-OCR-プログラム仕様書.md` | v1 仕様書 |
| `docs/obsidian/PDF-OCR-Mac版セットアップ手順.md` | Mac セットアップ |
| `docs/obsidian/PDF-OCR-Windows版セットアップ手順.md` | Windows セットアップ |

---

## 14. 用語集

| 用語 | 説明 |
|------|------|
| OCR | Optical Character Recognition（光学文字認識） |
| Tesseract | Google 系 OSS の OCR エンジン |
| PyMuPDF | PDF 処理ライブラリ（`pymupdf`） |
| DPI | 画像化解像度。高いほど精度↑、速度↓ |
| localhost | 自分の PC 自身。`127.0.0.1` で表す |
| tessdata | Tesseract の言語モデルファイル群 |
