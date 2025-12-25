using System;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;
using Microsoft.Win32;
using WinForms = System.Windows.Forms;
using MessageBox = System.Windows.MessageBox;

namespace VideoDownloader
{
    public partial class MainWindow : Window
    {
        private string selectedPath = "";
        private Process? downloadProcess;
        private bool isDownloading = false;

        public MainWindow()
        {
            InitializeComponent();
        }

        private void BrowseButton_Click(object sender, RoutedEventArgs e)
        {
            using (var dialog = new WinForms.FolderBrowserDialog())
            {
                if (dialog.ShowDialog() == WinForms.DialogResult.OK)
                {
                    selectedPath = dialog.SelectedPath;
                    PathLabel.Content = selectedPath;
                }
            }
        }

        private async void DownloadButton_Click(object sender, RoutedEventArgs e)
        {
            if (isDownloading)
            {
                return;
            }

            string url = LinkTextBox.Text.Trim();
            if (string.IsNullOrEmpty(url))
            {
                MessageBox.Show("Vui lòng nhập link video!", "Lỗi", MessageBoxButton.OK, MessageBoxImage.Error);
                return;
            }

            if (string.IsNullOrEmpty(selectedPath) || !Directory.Exists(selectedPath))
            {
                MessageBox.Show("Vui lòng chọn thư mục lưu hợp lệ!", "Lỗi", MessageBoxButton.OK, MessageBoxImage.Error);
                return;
            }

            // Check if yt-dlp is installed
            string ytDlpPath = FindYtDlp();
            if (string.IsNullOrEmpty(ytDlpPath))
            {
                MessageBox.Show("Không tìm thấy yt-dlp!\n\nVui lòng cài đặt yt-dlp:\npip install yt-dlp\n\nHoặc tải từ: https://github.com/yt-dlp/yt-dlp", 
                    "Lỗi", MessageBoxButton.OK, MessageBoxImage.Error);
                return;
            }

            isDownloading = true;
            DownloadButton.IsEnabled = false;
            DownloadButton.Content = "Đang tải...";
            ProgressBar.Value = 0;
            StatusLabel.Content = "Đang bắt đầu tải...";
            TimeLabel.Content = "";

            await Task.Run(() => DownloadVideo(url, selectedPath, ytDlpPath));
        }

        private string FindYtDlp()
        {
            // Check if yt-dlp is in PATH
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = "yt-dlp",
                    Arguments = "--version",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                };

                using (Process p = Process.Start(psi)!)
                {
                    p.WaitForExit(3000); // Wait max 3 seconds
                    if (p.ExitCode == 0)
                    {
                        return "yt-dlp";
                    }
                }
            }
            catch { }

            // Check common Python installation paths
            try
            {
                string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                string[] searchPaths = {
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Python"),
                    Path.Combine(userProfile, "AppData", "Local", "Programs", "Python"),
                    Path.Combine(userProfile, "AppData", "Roaming", "Python"),
                    @"C:\Python"
                };

                foreach (var basePath in searchPaths)
                {
                    if (Directory.Exists(basePath))
                    {
                        var dirs = Directory.GetDirectories(basePath, "Python*", SearchOption.TopDirectoryOnly);
                        foreach (var dir in dirs)
                        {
                            string scriptPath = Path.Combine(dir, "Scripts", "yt-dlp.exe");
                            if (File.Exists(scriptPath))
                            {
                                return scriptPath;
                            }
                        }
                    }
                }
            }
            catch { }

            return "";
        }

        private void DownloadVideo(string url, string outputPath, string ytDlpPath)
        {
            string errorOutput = "";
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = ytDlpPath,
                    Arguments = $"-o \"{outputPath}\\%(title)s.%(ext)s\" --newline --progress \"{url}\"",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true,
                    StandardOutputEncoding = System.Text.Encoding.UTF8,
                    StandardErrorEncoding = System.Text.Encoding.UTF8
                };

                downloadProcess = Process.Start(psi);
                if (downloadProcess == null)
                {
                    Dispatcher.Invoke(() =>
                    {
                        MessageBox.Show("Không thể khởi động quá trình tải!", "Lỗi", 
                            MessageBoxButton.OK, MessageBoxImage.Error);
                        ResetUI();
                    });
                    return;
                }

                // Read error stream asynchronously to avoid deadlock
                Task.Run(() =>
                {
                    try
                    {
                        string? errorLine;
                        while ((errorLine = downloadProcess?.StandardError.ReadLine()) != null)
                        {
                            errorOutput += errorLine + Environment.NewLine;
                        }
                    }
                    catch { }
                });

                // Read output stream
                string? line;
                while ((line = downloadProcess.StandardOutput.ReadLine()) != null)
                {
                    if (string.IsNullOrEmpty(line)) continue;
                    ParseProgress(line);
                }

                downloadProcess.WaitForExit();

                Dispatcher.Invoke(() =>
                {
                    if (downloadProcess.ExitCode == 0)
                    {
                        ProgressBar.Value = 100;
                        StatusLabel.Content = "Hoàn thành!";
                        TimeLabel.Content = "Tải xuống thành công!";
                        MessageBox.Show("Tải video thành công!", "Thành công", 
                            MessageBoxButton.OK, MessageBoxImage.Information);
                    }
                    else
                    {
                        string errorMsg = string.IsNullOrWhiteSpace(errorOutput) 
                            ? "Không thể tải video. Vui lòng kiểm tra link và thử lại." 
                            : errorOutput;
                        MessageBox.Show($"Lỗi khi tải video:\n{errorMsg}", "Lỗi", 
                            MessageBoxButton.OK, MessageBoxImage.Error);
                        StatusLabel.Content = "Lỗi!";
                    }
                    ResetUI();
                });
            }
            catch (Exception ex)
            {
                Dispatcher.Invoke(() =>
                {
                    MessageBox.Show($"Lỗi: {ex.Message}", "Lỗi", 
                        MessageBoxButton.OK, MessageBoxImage.Error);
                    StatusLabel.Content = "Lỗi!";
                    ResetUI();
                });
            }
            finally
            {
                downloadProcess?.Dispose();
                downloadProcess = null;
            }
        }

        private void ParseProgress(string line)
        {
            // Parse yt-dlp progress output
            // Format: [download]  45.2% of 123.45MiB at 1.23MiB/s ETA 00:45
            var match = Regex.Match(line, @"\[download\]\s+(\d+\.?\d*)%");
            if (match.Success)
            {
                if (double.TryParse(match.Groups[1].Value, out double percent))
                {
                    Dispatcher.Invoke(() =>
                    {
                        ProgressBar.Value = percent;
                        StatusLabel.Content = $"Đang tải: {percent:F1}%";
                    });
                }
            }

            // Parse speed and ETA
            var speedMatch = Regex.Match(line, @"at\s+([\d.]+)(\w+)/s");
            var etaMatch = Regex.Match(line, @"ETA\s+(\d+):(\d+)");
            
            if (speedMatch.Success || etaMatch.Success)
            {
                string speedText = speedMatch.Success ? $"{speedMatch.Groups[1].Value} {speedMatch.Groups[2].Value}/s" : "";
                string etaText = etaMatch.Success ? $"{etaMatch.Groups[1].Value}:{etaMatch.Groups[2].Value}" : "";
                
                Dispatcher.Invoke(() =>
                {
                    if (!string.IsNullOrEmpty(speedText) || !string.IsNullOrEmpty(etaText))
                    {
                        TimeLabel.Content = $"Tốc độ: {speedText} | Còn lại: {etaText}";
                    }
                });
            }
        }

        private void ResetUI()
        {
            isDownloading = false;
            DownloadButton.IsEnabled = true;
            DownloadButton.Content = "Tải Video";
        }
    }
}

