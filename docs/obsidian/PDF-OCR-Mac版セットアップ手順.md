# PDF OCR アプリ — Mac版セットアップ手順

スキャンしたPDFをOCRでテキストに変換するWebアプリの、**macOS 向けセットアップ手順**です。

> **機密性について**  
> 個人情報を扱う場合は、クラウド公開や ngrok は使わず、この Mac 上で `http://127.0.0.1:8000` としてローカル実行してください。PDF は外部サーバーへ送信されません。

---

## 必要なもの

- macOS（自宅 Mac）
- Chrome などのブラウザ
- インターネット接続（初回インストール時のみ）

---

## 1. Tesseract（OCRエンジン）をインストール

ターミナルを開き、以下を実行します。

```bash
brew install tesseract tesseract-lang
```

すでにインストール済みの場合:

```text
Warning: tesseract-lang 4.1.0 is already installed and up-to-date.
```

と表示されれば問題ありません。

---

## 2. アプリを取得

### 方法A: ZIP でダウンロード（おすすめ）

1. GitHub にログイン  
   https://github.com/yossaeki-beep/my-first-app
2. ブランチ `cursor/pdf-ocr-to-text-a59d` を選択
3. 緑色の **Code** → **Local** → **Download ZIP**
4. ZIP を解凍

### 方法B: git clone

```bash
git clone https://github.com/yossaeki-beep/my-first-app.git
cd my-first-app
git checkout cursor/pdf-ocr-to-text-a59d
```

---

## 3. フォルダを配置

Downloads から解凍した場合、`Operation not permitted` エラーを避けるため、ホームフォルダへ移動することをおすすめします。

```bash
mv ~/Downloads/my-first-app-cursor-pdf-ocr-to-text-a59d ~/my-first-app
cd ~/my-first-app
```

---

## 4. Python 環境をセットアップ

ターミナルで **1行ずつ** 実行します。

```bash
cd ~/my-first-app
```

```bash
python3 -m venv .venv
```

```bash
source .venv/bin/activate
```

プロンプトの先頭に `(.venv)` と表示されれば成功です。

```bash
pip install -r requirements.txt
```

---

## 5. サーバーを起動

```bash
python app.py
```

次のような表示が出れば成功です。

```text
Uvicorn running on http://127.0.0.1:8000
```

**このターミナルは閉じないでください。**

---

## 6. Chrome で開く

アドレスバーに以下を入力します。

```
http://127.0.0.1:8000
```

---

## 7. 使い方

1. PDF をドラッグ＆ドロップ（またはファイル選択）
2. 言語・解像度（DPI）を選ぶ
3. **変換する** をクリック
4. 結果を確認し、必要なら **テキストをダウンロード**

---

## 2回目以降の起動（短縮版）

```bash
cd ~/my-first-app
source .venv/bin/activate
python app.py
```

Chrome: `http://127.0.0.1:8000`

---

## トラブルシューティング

### `Operation not permitted`（venv 作成時）

- フォルダを `~/my-first-app` に移して再試行
- **システム設定** → **プライバシーとセキュリティ** → **フルディスクアクセス** → **ターミナル** をオン

### `tesseract is not installed`

```bash
brew install tesseract tesseract-lang
```

### ブラウザでページが開けない

- `python app.py` が起動しているか確認
- URL は `http://127.0.0.1:8000`（`https` ではない）

### 日本語の認識精度が低い

- ブラウザ上で DPI を **400** に上げて再試行

---

## セキュリティ上の注意

- **`127.0.0.1` のみ** で利用する（`0.0.0.0` や ngrok は使わない）
- 不要になった PDF / テキストファイルは削除する
- 個人情報を含むファイルをメール・クラウドに載せない

---

## 関連

- [[PDF-OCR-Windows版セットアップ手順]]
- リポジトリ: https://github.com/yossaeki-beep/my-first-app
