$ErrorActionPreference = "Stop"
$ROOT = $PSScriptRoot
if (-not $ROOT) { $ROOT = (Get-Item -Path ".").FullName }
$VENV  = Join-Path $ROOT ".venv"
$WEBUI = Join-Path $ROOT "webui"

Write-Host "" 
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  ZeroTTS Setup & Run" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$pythonExe = $null

# 1. Tim python he thong
$candidates = @("python3.11","python3.12","python3.10","python3","python")
foreach ($cmd in $candidates) {
    $p = Get-Command $cmd -ErrorAction SilentlyContinue
    if ($p -and $p.Source -notmatch "WindowsApps") { $pythonExe = $p.Source; break }
}

# 2. Cai Python qua winget neu chua co
if (-not $pythonExe) {
    Write-Host "[!] Chua co Python — cai Python 3.11 qua winget..." -ForegroundColor Yellow
    winget install --id Python.Python.3.11 --silent --accept-source-agreements --accept-package-agreements
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
    $p = Get-Command "python" -ErrorAction SilentlyContinue
    if ($p) { $pythonExe = $p.Source }
    else { Write-Host "[ERR] Cai that bai. Vao python.org tai thu cong." -ForegroundColor Red; exit 1 }
}

Write-Host "[OK] Python: $pythonExe" -ForegroundColor Green
& $pythonExe --version

# 3. Tao venv
if (-not (Test-Path (Join-Path $VENV "Scripts\python.exe"))) {
    Write-Host "[*] Tao .venv ..." -ForegroundColor Cyan
    & $pythonExe -m venv $VENV
}
$pythonExe = Join-Path $VENV "Scripts\python.exe"
$pipExe    = Join-Path $VENV "Scripts\pip.exe"

# 4. Cai thu vien
Write-Host "[*] Cap nhat pip + cai thu vien..." -ForegroundColor Cyan
& $pythonExe -m pip install --upgrade pip -q
& $pipExe install -e "$ROOT[webui]" -q
& $pipExe install scipy -q

Write-Host "[OK] Xong!" -ForegroundColor Green
Write-Host ""
Write-Host "Kiem tra phien ban..." -ForegroundColor Cyan
& $pythonExe -c "import scipy; import gradio; print('scipy OK'); print('gradio OK')"
