@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo エラー: .venv が見つかりません。
    echo 先に python -m venv .venv と pip install -r requirements.txt を実行してください。
    pause
    exit /b 1
)

echo PDF OCR サーバーを起動しています...
start "PDF OCR Server" .venv\Scripts\python.exe app.py

echo ブラウザを開くまで少し待ちます...
timeout /t 3 /nobreak >nul
start "" http://127.0.0.1:8000

echo.
echo 起動しました。
echo 終了するときは「PDF OCR Server」という黒い窓を閉じてください。
echo この窓は閉じても構いません。
pause
