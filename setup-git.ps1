# Script tự động setup và đẩy code lên GitHub
# Chạy: .\setup-git.ps1

Write-Host "🚀 Setting up Git repository..." -ForegroundColor Green

# Kiểm tra Git đã cài chưa
try {
    $gitVersion = git --version
    Write-Host "✅ Git found: $gitVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Git chưa được cài đặt!" -ForegroundColor Red
    Write-Host "Vui lòng cài Git từ: https://git-scm.com/download/win" -ForegroundColor Yellow
    Write-Host "Hoặc chạy: winget install Git.Git" -ForegroundColor Yellow
    exit 1
}

# Kiểm tra đã có .git chưa
if (Test-Path .git) {
    Write-Host "⚠️  Git repository đã được khởi tạo" -ForegroundColor Yellow
    $continue = Read-Host "Tiếp tục? (y/n)"
    if ($continue -ne "y") {
        exit 0
    }
} else {
    Write-Host "📦 Khởi tạo Git repository..." -ForegroundColor Cyan
    git init
}

# Thêm remote
$remoteUrl = "https://github.com/tangteu2703/MaMaOne.git"
Write-Host "🔗 Thêm remote repository..." -ForegroundColor Cyan
git remote remove origin 2>$null
git remote add origin $remoteUrl

# Kiểm tra remote
Write-Host "`n📋 Remote repositories:" -ForegroundColor Cyan
git remote -v

# Thêm files
Write-Host "`n📝 Thêm files vào staging..." -ForegroundColor Cyan
git add .

# Hiển thị status
Write-Host "`n📊 Git status:" -ForegroundColor Cyan
git status

# Commit
$commitMessage = "Initial commit: Video Downloader - Multi Platform (Python, C#, JavaScript)"
Write-Host "`n💾 Commit với message: $commitMessage" -ForegroundColor Cyan
git commit -m $commitMessage

# Đặt branch chính
Write-Host "`n🌿 Đặt branch chính là 'main'..." -ForegroundColor Cyan
git branch -M main

# Hướng dẫn push
Write-Host "`n✅ Setup hoàn tất!" -ForegroundColor Green
Write-Host "`n📤 Để đẩy lên GitHub, chạy:" -ForegroundColor Yellow
Write-Host "   git push -u origin main" -ForegroundColor White
Write-Host "`n⚠️  Lưu ý: Bạn cần Personal Access Token để push" -ForegroundColor Yellow
Write-Host "   Xem hướng dẫn trong file GIT_SETUP.md" -ForegroundColor Yellow

