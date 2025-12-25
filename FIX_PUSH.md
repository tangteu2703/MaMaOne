# 🔧 Sửa lỗi Push lên GitHub

## Vấn đề
Repository trên GitHub đã có code (README.md mặc định), cần merge với code local trước khi push.

## Giải pháp

### Cách 1: Pull và merge (Khuyên dùng)
```bash
# Pull code từ GitHub và merge
git pull origin main --allow-unrelated-histories

# Nếu có conflict, giải quyết conflict rồi:
git add .
git commit -m "Merge remote and local code"

# Sau đó push
git push -u origin main
```

### Cách 2: Force push (Chỉ dùng nếu chắc chắn muốn ghi đè code trên GitHub)
```bash
# ⚠️ CẢNH BÁO: Sẽ xóa code trên GitHub!
git push -u origin main --force
```

### Cách 3: Rebase (Giữ lịch sử sạch)
```bash
git pull origin main --rebase --allow-unrelated-histories
git push -u origin main
```

## Khuyến nghị
Dùng **Cách 1** để giữ cả code local và remote.

