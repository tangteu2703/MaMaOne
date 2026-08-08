# TikTok Auto System — AIBeta 🤖

Hệ thống tự động: **Cào TikTok Trend → Dịch AI → Tạo Voice → Ghép Video → Đăng TikTok**

## 🏗 Cấu trúc Project

```
AIBeta/
├── pipeline.js          ← Orchestrator chính, chạy toàn bộ
├── scheduler.js         ← Cron job tự động 8h/12h/18h
├── config/
│   └── config.js        ← Cấu hình tập trung
├── src/
│   ├── scraper/         ← Cào trend TikTok (Apify API)
│   ├── downloader/      ← Tải video không watermark (yt-dlp)
│   ├── translator/      ← Dịch + viết kịch bản AI (Gemini)
│   ├── tts/             ← Tạo giọng đọc (Edge-TTS miễn phí)
│   ├── editor/          ← Ghép video + subtitle (FFmpeg)
│   └── uploader/        ← Đăng lên TikTok (Playwright)
└── workspace/           ← Thư mục làm việc
    ├── downloads/        ← Video gốc đã tải
    ├── audio/            ← File voice AI
    └── output/           ← Video final sẵn đăng
```

## ⚡ Cài Đặt Nhanh

### Bước 1: Cài dependencies
```bash
npm install
npm run install-browser    # Cài Chromium cho Playwright
pip install yt-dlp edge-tts  # Cài Python tools
```

### Bước 2: Cấu hình API Keys

Mở file `.env` và điền:
```env
APIFY_API_TOKEN=your_token    # https://console.apify.com
GEMINI_API_KEY=your_key       # https://aistudio.google.com
```

### Bước 3: Cài FFmpeg

Tải tại: https://ffmpeg.org/download.html
Giải nén và thêm vào PATH Windows

## 🚀 Chạy Pipeline

```bash
# Chạy 1 lần ngay (test)
npm run run-now

# Chạy với hashtag tùy chỉnh
node pipeline.js --hashtags python,coding,ai --max 2

# Chạy tự động theo lịch (8h/12h/18h)
npm start

# Test từng module riêng lẻ
npm run test-scraper     # Test cào data
npm run test-script      # Test viết kịch bản AI
```

## 📝 Lần Đầu Chạy

Khi chạy lần đầu, Playwright sẽ mở trình duyệt và yêu cầu bạn đăng nhập TikTok thủ công.
Sau đó hệ thống sẽ lưu session cookie và tự động đăng nhập mọi lần sau.

## 🔑 API Keys Cần Thiết

| API | Link đăng ký | Miễn phí |
|-----|-------------|---------|
| Apify | https://console.apify.com | ✅ $5/tháng |
| Gemini | https://aistudio.google.com | ✅ Free tier |
| Edge-TTS | Không cần key | ✅ Hoàn toàn miễn phí |
| Playwright | Không cần key | ✅ Open source |
