# my-first-app

スキャンしたPDFをOCRでテキストファイルに変換するWebアプリです。**Chrome などのブラウザ**から利用することを想定しています（iPhone向けではありません）。

## 必要なもの

### macOS（Homebrew）

```bash
brew install tesseract tesseract-lang
```

### Python 依存関係

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 使い方（ブラウザ）

1. サーバーを起動

```bash
source .venv/bin/activate
python app.py
```

2. Chrome などのブラウザで開く

```
http://127.0.0.1:8000
```

3. PDFをドラッグ＆ドロップ（またはファイル選択）して「変換する」をクリック
4. 変換結果を確認し、必要なら「テキストをダウンロード」

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

Tesseract が未インストールです。上記の macOS 手順を実行してください。

### 日本語が文字化け・誤認識される

- `tesseract-lang`（または `tesseract-ocr-jpn`）が入っているか確認してください。
- ブラウザ上で DPI を 400 に上げて再試行してください。

### ブラウザでページが開けない

- `python app.py` が起動しているか確認してください。
- アドレスは `http://127.0.0.1:8000` です。
