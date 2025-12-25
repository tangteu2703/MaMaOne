# 🚀 Hướng dẫn đẩy code lên GitHub

## Bước 1: Cài đặt Git (nếu chưa có)

Tải Git từ: https://git-scm.com/download/win

Hoặc dùng winget:
```powershell
winget install Git.Git
```

## Bước 2: Khởi tạo Git Repository

Mở PowerShell/Terminal trong folder project và chạy:

```bash
# Khởi tạo git repository
git init

# Thêm remote repository
git remote add origin https://github.com/tangteu2703/MaMaOne.git

# Kiểm tra remote
git remote -v
```

## Bước 3: Thêm và Commit files

```bash
# Thêm tất cả files
git add .

# Commit lần đầu
git commit -m "Initial commit: Video Downloader - Python, C#, JavaScript"

# Đặt tên branch chính (nếu cần)
git branch -M main
```

## Bước 4: Đẩy lên GitHub

```bash
# Đẩy lên GitHub (lần đầu)
git push -u origin main
```

Nếu gặp lỗi authentication, bạn cần:
1. Tạo Personal Access Token trên GitHub
2. Dùng token thay vì password khi push

## 🔐 Tạo Personal Access Token

1. Vào GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Chọn quyền: `repo` (full control)
4. Copy token và dùng khi push

## 📝 Lệnh đầy đủ (Copy & Paste)

```bash
git init
git remote add origin https://github.com/tangteu2703/MaMaOne.git
git add .
git commit -m "Initial commit: Video Downloader - Multi Platform"
git branch -M main
git push -u origin main
```

## ⚠️ Lưu ý

- Đảm bảo đã có file `.gitignore` để không commit các file không cần thiết
- Kiểm tra lại files trước khi commit: `git status`
- Nếu repository trên GitHub đã có files, cần pull trước: `git pull origin main --allow-unrelated-histories`

