# Video Downloader - Browser Extension

Extension trình duyệt với Bootstrap 5 để tải video từ YouTube, TikTok, Douyin và nhiều nền tảng khác.

## 🚀 Cài đặt

### 0. Tạo Icons (Quan trọng!)

Extension cần icons để hiển thị. Có 3 cách:

**Cách 1: Dùng HTML Generator (Dễ nhất)**
1. Mở file `create-icons.html` trong browser
2. Click các nút để download icon16.png, icon48.png, icon128.png
3. Đặt vào folder `icons/`

**Cách 2: Tạo thủ công**
- Tạo 3 file PNG: 16x16, 48x48, 128x128 pixels
- Màu nền: #4CAF50 (xanh lá)
- Icon: Mũi tên download màu trắng
- Đặt vào folder `icons/`

**Cách 3: Dùng placeholder**
- Tải từ: https://via.placeholder.com/128/4CAF50/FFFFFF?text=↓
- Resize thành 3 kích thước: 16, 48, 128

### 1. Cài đặt yt-dlp
```bash
pip install yt-dlp
```

### 2. Cài đặt Node.js dependencies
```bash
cd JavaScript
npm install
```

### 3. Chạy Backend Service
```bash
npm start
# hoặc
node server.js
```

Backend sẽ chạy tại: `http://localhost:3000`

### 4. Cài đặt Extension vào Chrome/Edge

1. Mở Chrome/Edge và vào `chrome://extensions/` hoặc `edge://extensions/`
2. Bật **Developer mode** (góc trên bên phải)
3. Click **Load unpacked**
4. Chọn folder `JavaScript`
5. Extension sẽ xuất hiện trong toolbar

## 📦 Cấu trúc

```
JavaScript/
├── manifest.json          # Extension manifest
├── popup.html            # Giao diện popup (Bootstrap 5)
├── popup.js              # Logic xử lý download
├── background.js         # Service worker
├── content.js            # Content script
├── server.js             # Node.js backend
├── package.json          # Dependencies
└── README.md            # Hướng dẫn
```

## 🎨 Tính năng

- ✅ Giao diện Bootstrap 5 đẹp mắt
- ✅ Hỗ trợ YouTube, TikTok, Douyin, Facebook, Instagram
- ✅ Hiển thị tiến trình tải (%)
- ✅ Hiển thị tốc độ và thời gian còn lại
- ✅ Tự động phát hiện link video từ tab hiện tại
- ✅ Lưu cài đặt vào storage

## 🔧 Sử dụng

1. Click vào icon extension trên toolbar
2. Dán link video vào ô đầu tiên (hoặc extension tự động lấy từ tab hiện tại)
3. Chọn thư mục lưu (hoặc để mặc định Downloads)
4. Click "Tải Video"
5. Theo dõi tiến trình tải

## ⚙️ Cấu hình

Extension sử dụng backend service tại `http://localhost:3000` mặc định.

Để thay đổi:
1. Mở popup extension
2. Vào Developer Tools (F12)
3. Chạy: `chrome.storage.local.set({ backendUrl: 'http://your-url:port' })`

## 🐛 Troubleshooting

**Extension không tải được video:**
- Kiểm tra backend service đã chạy chưa: `http://localhost:3000/api/health`
- Kiểm tra yt-dlp đã cài đặt: `yt-dlp --version`
- Xem console trong Developer Tools để debug

**Backend không kết nối được:**
- Đảm bảo port 3000 không bị chặn bởi firewall
- Kiểm tra yt-dlp có trong PATH hoặc cài đặt đúng đường dẫn

## 📝 Lưu ý

- Extension cần backend service để gọi yt-dlp (do giới hạn của browser)
- Backend service phải chạy trên cùng máy với trình duyệt
- Video sẽ được tải vào thư mục đã chọn trên máy local

