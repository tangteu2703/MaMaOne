# Video Downloader - WPF (C#)

Ứng dụng tải video WPF hỗ trợ YouTube, TikTok, Douyin và nhiều nền tảng khác.

## Yêu cầu

- .NET 8.0 SDK hoặc Visual Studio 2022
- yt-dlp đã được cài đặt (pip install yt-dlp)

## Cài đặt yt-dlp

```bash
pip install yt-dlp
```

Hoặc tải từ: https://github.com/yt-dlp/yt-dlp

## Chạy ứng dụng

### Cách 1: Visual Studio
1. Mở `VideoDownloader.sln` trong Visual Studio
2. Nhấn F5 để chạy

### Cách 2: Command Line
```bash
cd VideoDownloader
dotnet build
dotnet run
```

## Tính năng

- Giao diện WPF đẹp mắt
- Hỗ trợ nhiều nền tảng: YouTube, TikTok, Douyin, Facebook, Instagram, v.v.
- Hiển thị tiến trình tải (%)
- Hiển thị tốc độ tải và thời gian còn lại
- Tự động tìm yt-dlp trong hệ thống

## Giao diện

- **Dòng 1**: Nhập link video
- **Dòng 2**: Chọn thư mục lưu
- **Dòng 3**: Nút tải + thanh tiến trình

