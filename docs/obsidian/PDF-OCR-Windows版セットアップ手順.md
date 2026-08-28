# PDF OCR アプリ — Windows版セットアップ手順

スキャンしたPDFをOCRでテキストに変換するWebアプリの、**Windows（職場PC）向けセットアップ手順**です。

> **機密性について**  
> 個人情報を扱う場合は、**職場 PC 上だけ**でローカル実行してください。  
> クラウド公開・ngrok は使わず、`http://127.0.0.1:8000` のみで利用します。  
> PDF はその PC 内だけで処理され、外部サーバーへ送信されません。

---

## 事前確認

- 職場 PC に **Python** と **Tesseract** をインストールしてよいか、社内ルール・IT部門に確認する
- 職場 PC は **Windows**
- ブラウザは **Chrome** 推奨

---

## 1. Python をインストール

1. https://www.python.org/downloads/ を開く
2. **Download Python** をクリック
3. インストール時に **「Add python.exe to PATH」** に必ずチェック
4. **Install Now** でインストール

### 確認（PowerShell）

```powershell
python --version
```

バージョンが表示されれば OK です。

---

## 2. Tesseract OCR をインストール

1. https://github.com/UB-Mannheim/tesseract/wiki を開く
2. 最新の Windows インストーラ（`.exe`）をダウンロード
3. インストール時に **Additional language data** で **Japanese** にチェック
4. インストール完了まで進める

### 確認

次のファイルが存在するか確認します。

```
C:\Program Files\Tesseract-OCR\tesseract.exe
```

---

## 3. アプリを職場 PC に置く

### 方法A: ZIP で持ち込む（おすすめ）

1. 自宅 Mac または GitHub から ZIP を取得
   - リポジトリ: https://github.com/yossaeki-beep/my-first-app
   - ブランチ: `cursor/pdf-ocr-to-text-a59d`
   - **Code** → **Local** → **Download ZIP**
2. USB メモリ等で職場 PC にコピー
3. 例: `C:\Users\あなたの名前\my-first-app` に解凍

### 方法B: git clone（社内で git が使える場合）

```powershell
git clone https://github.com/yossaeki-beep/my-first-app.git
cd my-first-app
git checkout cursor/pdf-ocr-to-text-a59d
```

---

## 4. PowerShell でセットアップ

1. 解凍した `my-first-app` フォルダを開く
2. フォルダ内で **Shift + 右クリック** → **PowerShell ウィンドウをここで開く**
3. **1行ずつ** 実行:

```powershell
python -m venv .venv
```

```powershell
.venv\Scripts\Activate.ps1
```

プロンプトの先頭に `(.venv)` と表示されれば成功です。

#### スクリプト実行が拒否される場合

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

その後、もう一度:

```powershell
.venv\Scripts\Activate.ps1
```

```powershell
pip install -r requirements.txt
```

---

## 5. サーバーを起動

```powershell
python app.py
```

次のような表示が出れば成功です。

```text
Uvicorn running on http://127.0.0.1:8000
```

**この PowerShell は閉じないでください。**

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
   - 既定: 日本語 + 英語（`jpn+eng`）
3. **変換する** をクリック
4. 結果を確認し、必要なら **テキストをダウンロード**

---

## 2回目以降の起動（短縮版）

```powershell
cd C:\Users\あなたの名前\my-first-app
.venv\Scripts\Activate.ps1
python app.py
```

Chrome: `http://127.0.0.1:8000`

---

## トラブルシューティング

### `python` が見つからない

- Python を再インストールし、**Add python.exe to PATH** にチェック
- PC を再起動してから再試行

### `tesseract is not installed`

- Tesseract を再インストール（**Japanese** 言語データ付き）
- インストール先: `C:\Program Files\Tesseract-OCR\`

### PowerShell で `.venv\Scripts\Activate.ps1` が実行できない

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### ブラウザでページが開けない

- `python app.py` が起動しているか確認
- URL は `http://127.0.0.1:8000`（`https` ではない）

### 日本語の認識精度が低い

- ブラウザ上で DPI を **400** に上げて再試行
- Tesseract インストール時に Japanese が選ばれているか確認

---

## セキュリティ上の注意

- **`127.0.0.1` のみ** で利用する（他 PC からアクセスさせない）
- **`0.0.0.0`** や **ngrok** は使わない
- PDF / 変換後テキストは職場 PC 内だけに置く
- 不要ファイルは削除する
- 個人情報を含むファイルをメール・クラウドに載せない

---

## 関連

- [[PDF-OCR-Mac版セットアップ手順]]
- リポジトリ: https://github.com/yossaeki-beep/my-first-app
