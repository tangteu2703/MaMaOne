import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import threading
import os
from pathlib import Path
import yt_dlp
import time

class VideoDownloader:
    def __init__(self, root):
        self.root = root
        self.root.title("Video Downloader")
        self.root.geometry("600x200")
        self.root.resizable(False, False)
        
        # Variables
        self.download_path = tk.StringVar(value="Chọn thư mục lưu...")
        self.downloading = False
        
        # Line 1: Link input
        frame1 = tk.Frame(root, pady=10)
        frame1.pack(fill=tk.X, padx=20)
        
        tk.Label(frame1, text="Link video:", width=12, anchor='w').pack(side=tk.LEFT)
        self.link_entry = tk.Entry(frame1, width=50)
        self.link_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(10, 0))
        
        # Line 2: Save location
        frame2 = tk.Frame(root, pady=10)
        frame2.pack(fill=tk.X, padx=20)
        
        tk.Label(frame2, text="Lưu tại:", width=12, anchor='w').pack(side=tk.LEFT)
        self.path_label = tk.Label(frame2, textvariable=self.download_path, 
                                   relief=tk.SUNKEN, anchor='w', bg='white', 
                                   width=40, padx=5)
        self.path_label.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(10, 0))
        
        btn_browse = tk.Button(frame2, text="Chọn...", command=self.browse_folder, width=10)
        btn_browse.pack(side=tk.LEFT, padx=(10, 0))
        
        # Line 3: Download button and progress
        frame3 = tk.Frame(root, pady=10)
        frame3.pack(fill=tk.X, padx=20)
        
        self.download_btn = tk.Button(frame3, text="Tải Video", 
                                      command=self.start_download, 
                                      bg='#4CAF50', fg='white',
                                      font=('Arial', 12, 'bold'),
                                      width=15, height=2)
        self.download_btn.pack(side=tk.LEFT)
        
        # Progress frame
        progress_frame = tk.Frame(frame3)
        progress_frame.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(20, 0))
        
        self.progress_label = tk.Label(progress_frame, text="Sẵn sàng", 
                                       font=('Arial', 10))
        self.progress_label.pack(anchor='w')
        
        self.progress_bar = ttk.Progressbar(progress_frame, mode='determinate', length=300)
        self.progress_bar.pack(fill=tk.X, pady=(5, 0))
        
        self.time_label = tk.Label(progress_frame, text="", font=('Arial', 9))
        self.time_label.pack(anchor='w', pady=(5, 0))
    
    def browse_folder(self):
        folder = filedialog.askdirectory()
        if folder:
            self.download_path.set(folder)
    
    def progress_hook(self, d):
        if d['status'] == 'downloading':
            if 'total_bytes' in d:
                total = d['total_bytes']
                downloaded = d.get('downloaded_bytes', 0)
                percent = (downloaded / total) * 100 if total > 0 else 0
                self.progress_bar['value'] = percent
                
                # Calculate speed and time
                speed = d.get('speed', 0)
                if speed and speed > 0:
                    remaining = (total - downloaded) / speed
                    self.time_label.config(
                        text=f"Đã tải: {percent:.1f}% | Tốc độ: {self.format_bytes(speed)}/s | Còn lại: {self.format_time(remaining)}"
                    )
                else:
                    self.time_label.config(text=f"Đã tải: {percent:.1f}%")
                    
            elif 'total_bytes_estimate' in d:
                total = d['total_bytes_estimate']
                downloaded = d.get('downloaded_bytes', 0)
                percent = (downloaded / total) * 100 if total > 0 else 0
                self.progress_bar['value'] = percent
                self.time_label.config(text=f"Đã tải: {percent:.1f}% (ước tính)")
            else:
                self.progress_label.config(text="Đang tải...")
                
        elif d['status'] == 'finished':
            self.progress_bar['value'] = 100
            self.progress_label.config(text="Hoàn thành!")
            self.time_label.config(text="Tải xuống thành công!")
            self.downloading = False
            self.download_btn.config(state=tk.NORMAL, text="Tải Video")
            messagebox.showinfo("Thành công", "Tải video thành công!")
    
    def format_bytes(self, bytes):
        for unit in ['B', 'KB', 'MB', 'GB']:
            if bytes < 1024.0:
                return f"{bytes:.2f} {unit}"
            bytes /= 1024.0
        return f"{bytes:.2f} TB"
    
    def format_time(self, seconds):
        if seconds < 60:
            return f"{int(seconds)} giây"
        elif seconds < 3600:
            return f"{int(seconds // 60)} phút {int(seconds % 60)} giây"
        else:
            hours = int(seconds // 3600)
            minutes = int((seconds % 3600) // 60)
            return f"{hours} giờ {minutes} phút"
    
    def start_download(self):
        if self.downloading:
            return
            
        link = self.link_entry.get().strip()
        if not link:
            messagebox.showerror("Lỗi", "Vui lòng nhập link video!")
            return
        
        save_path = self.download_path.get()
        if not save_path or save_path == "Chọn thư mục lưu...":
            messagebox.showerror("Lỗi", "Vui lòng chọn thư mục lưu!")
            return
        
        if not os.path.exists(save_path):
            messagebox.showerror("Lỗi", "Thư mục không tồn tại!")
            return
        
        self.downloading = True
        self.download_btn.config(state=tk.DISABLED, text="Đang tải...")
        self.progress_bar['value'] = 0
        self.progress_label.config(text="Đang bắt đầu tải...")
        self.time_label.config(text="")
        
        # Start download in separate thread
        thread = threading.Thread(target=self.download_video, args=(link, save_path))
        thread.daemon = True
        thread.start()
    
    def download_video(self, url, save_path):
        try:
            ydl_opts = {
                'outtmpl': os.path.join(save_path, '%(title)s.%(ext)s'),
                'progress_hooks': [self.progress_hook],
                'format': 'best',
            }
            
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])
                
        except Exception as e:
            self.root.after(0, lambda: messagebox.showerror("Lỗi", f"Lỗi khi tải video:\n{str(e)}"))
            self.root.after(0, lambda: self.progress_label.config(text="Lỗi!"))
            self.root.after(0, lambda: self.download_btn.config(state=tk.NORMAL, text="Tải Video"))
            self.downloading = False

def main():
    root = tk.Tk()
    app = VideoDownloader(root)
    root.mainloop()

if __name__ == "__main__":
    main()

