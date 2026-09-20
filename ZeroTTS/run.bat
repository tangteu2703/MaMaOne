@echo off
title ZeroTTS WebUI
cd /d "%~dp0"

set PYTHON="%~dp0.venv\Scripts\python.exe"

rem ── Corporate proxy SSL bypass ──────────────────────────────────────────────
set PYTHONHTTPSVERIFY=0
set HF_HUB_DISABLE_SSL_CHECK=1
set REQUESTS_CA_BUNDLE=
set CURL_CA_BUNDLE=
rem ────────────────────────────────────────────────────────────────────────────

echo.
echo ============================================================
echo   ZeroTTS WebUI - Dang khoi dong...
echo ============================================================
echo.
echo   Truy cap: http://localhost:7860
echo   Nhan Ctrl+C de dung.
echo.
%PYTHON% webui\app.py --port 7860
pause
