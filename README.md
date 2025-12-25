# Video Downloader - Multi-Platform

Ứng dụng tải video hỗ trợ YouTube, TikTok, Douyin và nhiều nền tảng khác, được phát triển trên 3 nền tảng: Python, C# (WPF), và JavaScript (Browser Extension).

## 📁 Cấu trúc Project

```
Extention/
├── Python/              # Ứng dụng Python với tkinter
├── CSharp/             # Ứng dụng WPF (C#)
├── JavaScript/          # Browser Extension với Bootstrap 5
└── README.md           # File này
```

## 🚀 Tính năng

- ✅ Hỗ trợ nhiều nền tảng: YouTube, TikTok, Douyin, Facebook, Instagram
- ✅ Giao diện đơn giản: 3 dòng (Link, Folder, Button + Progress)
- ✅ Hiển thị tiến trình tải (%)
- ✅ Hiển thị tốc độ và thời gian còn lại
- ✅ Tự động tìm yt-dlp trong hệ thống

## 📦 Yêu cầu

### Chung
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - Cài đặt: `pip install yt-dlp`

### Python
- Python 3.7+
- tkinter (thường có sẵn với Python)

### C# (WPF)
- .NET 8.0 SDK
- Visual Studio 2022 (khuyến nghị)

### JavaScript (Extension)
- Node.js 16+
- Chrome/Edge browser

## 🎯 Sử dụng

### Python
```bash
cd Python
pip install -r requirements.txt
python video_downloader.py
```

### C# (WPF)
```bash
cd CSharp/VideoDownloader
dotnet build
dotnet run
```

### JavaScript (Extension)
```bash
cd JavaScript
npm install
npm start  # Chạy backend service
# Sau đó cài extension vào Chrome/Edge
```

Xem chi tiết trong từng folder:
- [Python README](Python/README.md)
- [C# README](CSharp/README.md)
- [JavaScript README](JavaScript/README.md)

## 📝 License

MIT License

## 👤 Author

Created with ❤️ for easy video downloading

