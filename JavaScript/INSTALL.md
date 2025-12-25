# 📥 Hướng dẫn cài đặt Extension

## Bước 0: Tạo Icons (Bắt buộc!)

Extension cần icons để load. Làm theo một trong các cách:

### Cách 1: Dùng HTML Generator (Khuyên dùng)
1. Mở file `create-icons.html` trong Chrome/Edge
2. Click 3 nút để download: icon16.png, icon48.png, icon128.png
3. Tạo folder `icons` trong folder JavaScript
4. Đặt 3 file PNG vào folder `icons/`

### Cách 2: Tạo thủ công
Tạo 3 file PNG với kích thước:
- icon16.png (16x16 pixels)
- icon48.png (48x48 pixels)  
- icon128.png (128x128 pixels)

Màu: Nền xanh lá (#4CAF50), icon trắng (download arrow)

### Cách 3: Tạm thời bỏ icon
Nếu không muốn tạo icon ngay, có thể sửa `manifest.json` để bỏ phần icons (đã được sửa sẵn).

## Bước 1: Cài đặt yt-dlp

```bash
pip install yt-dlp
```

Kiểm tra cài đặt:
```bash
yt-dlp --version
```

## Bước 2: Cài đặt Node.js dependencies

```bash
cd JavaScript
npm install
```

## Bước 3: Chạy Backend Service

Mở terminal và chạy:
```bash
npm start
```

Hoặc:
```bash
node server.js
```

Bạn sẽ thấy:
```
🚀 Video Downloader Backend running on http://localhost:3000
📦 Make sure yt-dlp is installed: pip install yt-dlp
```

**Giữ terminal này mở** - backend service cần chạy liên tục.

## Bước 4: Cài đặt Extension vào Chrome/Edge

### Chrome:
1. Mở Chrome và vào `chrome://extensions/`
2. Bật **Developer mode** (toggle ở góc trên bên phải)
3. Click **Load unpacked**
4. Chọn folder `JavaScript` (folder chứa manifest.json)
5. Extension sẽ xuất hiện!

### Edge:
1. Mở Edge và vào `edge://extensions/`
2. Bật **Developer mode** (toggle ở góc dưới bên trái)
3. Click **Load unpacked**
4. Chọn folder `JavaScript`
5. Xong!

## Bước 5: Sử dụng

1. Click vào icon extension trên toolbar
2. Dán link video (hoặc extension tự động lấy từ tab hiện tại)
3. Click "Tải Video"
4. Theo dõi tiến trình!

## ⚠️ Lưu ý quan trọng

- **Backend service phải chạy** khi sử dụng extension
- Nếu không tải được, kiểm tra:
  - Backend đã chạy chưa? (`http://localhost:3000/api/health`)
  - yt-dlp đã cài chưa? (`yt-dlp --version`)
  - Port 3000 có bị chặn không?

## 🐛 Troubleshooting

**Extension báo lỗi "Không thể kết nối":**
- Đảm bảo `node server.js` đang chạy
- Kiểm tra `http://localhost:3000/api/health` trong browser

**Video không tải được:**
- Kiểm tra yt-dlp: `yt-dlp --version`
- Xem console trong Developer Tools (F12)

**Extension không hiển thị:**
- Refresh trang `chrome://extensions/`
- Reload extension (click icon reload)
- Kiểm tra có lỗi trong console

