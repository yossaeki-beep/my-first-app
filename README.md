# my-first-app

スキャンしたPDFをOCRでテキストファイルに変換するWebアプリです。**Chrome などのブラウザ**から利用することを想定しています（iPhone向けではありません）。

個人情報を扱う場合は、**クラウド公開や ngrok は使わず**、利用する PC 上で `http://127.0.0.1:8000` としてローカル実行してください。

## 必要なもの

### macOS（Homebrew）

```bash
brew install tesseract tesseract-lang
```

### Windows（職場PC向け）

1. **Python 3** をインストール  
   https://www.python.org/downloads/  
   インストール時に **Add python.exe to PATH** にチェックを入れる

2. **Tesseract OCR** をインストール  
   https://github.com/UB-Mannheim/tesseract/wiki  
   インストール時に **Additional language data** で **Japanese** にチェックを入れる

3. プロジェクトフォルダで PowerShell を開き、依存関係をインストール

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

PowerShell でスクリプト実行が拒否される場合:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### Python 依存関係（macOS / Linux）

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 使い方（ブラウザ）

1. サーバーを起動

macOS / Linux:

```bash
source .venv/bin/activate
python app.py
```

Windows:

```powershell
.venv\Scripts\Activate.ps1
python app.py
```

2. Chrome などのブラウザで開く

```
http://127.0.0.1:8000
```

3. PDFをドラッグ＆ドロップ（またはファイル選択）して「変換する」をクリック
4. 変換結果を確認し、必要なら「テキストをダウンロード」

## ワンクリック起動（PowerShell 不要）

### Windows

`my-first-app` フォルダ内の **`start.bat`** をダブルクリックします。

- サーバーが起動し、Chrome が自動で開きます
- 終了するときは **「PDF OCR Server」** という黒い窓を閉じてください

**デスクトップに置く方法**

1. `start.bat` を右クリック
2. **ショートカットの作成**
3. ショートカットをデスクトップに移動

### macOS

`start-mac.command` をダブルクリック（初回は右クリック → 開く）。

## 機密性について

- PDF は **その PC 内だけ** で処理されます（外部サーバーへ送信しません）
- **`127.0.0.1` のみ** で利用してください（`0.0.0.0` や ngrok は使わない）
- 不要になった PDF / テキストファイルは削除してください
- 職場PCへのソフトインストールは、社内ルール・IT部門の許可を確認してください

## CLI版（任意）

コマンドラインから使う場合:

```bash
python pdf_to_text.py document.pdf
```

### 出力先を指定

```bash
python pdf_to_text.py document.pdf -o output/result.txt
```

### フォルダ内のPDFを一括変換

```bash
python pdf_to_text.py scans/ -o output/
```

### 言語の指定

日本語と英語の混在文書向けに、既定では `jpn+eng` を使用します。

```bash
python pdf_to_text.py document.pdf -l jpn
python pdf_to_text.py document.pdf -l eng
```

### 解像度の調整

認識精度を上げたい場合は `--dpi` を上げてください（処理は遅くなります）。

```bash
python pdf_to_text.py document.pdf --dpi 400
```

## 注意事項

- スキャン品質（解像度・傾き・汚れ）によってOCR精度が変わります。
- 表や複雑なレイアウトは、テキストの並びが崩れることがあります。
- 手書き文字の認識精度は低くなる場合があります。
- Web版のアップロード上限は50MBです。

## トラブルシューティング

### `tesseract is not installed` と表示される

Tesseract が未インストールです。macOS / Windows のインストール手順を確認してください。

Windows では次の場所に入っているか確認してください。

```
C:\Program Files\Tesseract-OCR\tesseract.exe
```

### 日本語が文字化け・誤認識される

- `tesseract-lang`（または `tesseract-ocr-jpn`）が入っているか確認してください。
- ブラウザ上で DPI を 400 に上げて再試行してください。

### ブラウザでページが開けない

- `python app.py` が起動しているか確認してください。
- アドレスは `http://127.0.0.1:8000` です。
