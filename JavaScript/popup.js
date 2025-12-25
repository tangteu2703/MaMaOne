// DOM Elements
const videoLinkInput = document.getElementById('videoLink');
const savePathInput = document.getElementById('savePath');
const browseBtn = document.getElementById('browseBtn');
const downloadBtn = document.getElementById('downloadBtn');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const statusText = document.getElementById('statusText');
const percentText = document.getElementById('percentText');
const speedText = document.getElementById('speedText');
const timeText = document.getElementById('timeText');
const alertContainer = document.getElementById('alertContainer');

// State
let isDownloading = false;
let downloadInterval = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadSavedPath();
    
    // Get current tab URL if on video page
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && isValidVideoUrl(tabs[0].url)) {
            videoLinkInput.value = tabs[0].url;
        }
    });

    // Event Listeners
    browseBtn.addEventListener('click', handleBrowseFolder);
    downloadBtn.addEventListener('click', handleDownload);
    videoLinkInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleDownload();
        }
    });
});

// Check if URL is a video platform
function isValidVideoUrl(url) {
    const videoDomains = [
        'youtube.com', 'youtu.be',
        'tiktok.com', 'vm.tiktok.com',
        'douyin.com',
        'facebook.com', 'fb.watch',
        'instagram.com',
        'twitter.com', 'x.com'
    ];
    return videoDomains.some(domain => url.includes(domain));
}

// Load saved path from storage
function loadSavedPath() {
    chrome.storage.local.get(['savePath'], (result) => {
        if (result.savePath) {
            savePathInput.value = result.savePath;
        } else {
            // Default to Downloads folder
            savePathInput.value = 'Downloads';
        }
    });
}

// Handle browse folder (for Electron or desktop app)
async function handleBrowseFolder() {
    // In browser extension, we can't directly browse folders
    // So we'll use a text input or suggest default location
    const defaultPath = savePathInput.value || 'Downloads';
    
    // For now, just show a message
    showAlert('info', 'Trong trình duyệt, video sẽ được tải vào thư mục Downloads mặc định. Để chọn thư mục, vui lòng sử dụng Electron app.');
    
    // Save to storage
    chrome.storage.local.set({ savePath: defaultPath });
}

// Handle download
async function handleDownload() {
    if (isDownloading) {
        return;
    }

    const url = videoLinkInput.value.trim();
    if (!url) {
        showAlert('warning', 'Vui lòng nhập link video!');
        return;
    }

    if (!isValidVideoUrl(url)) {
        showAlert('warning', 'Link không hợp lệ hoặc không được hỗ trợ!');
        return;
    }

    isDownloading = true;
    downloadBtn.disabled = true;
    downloadBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Đang tải...';
    progressContainer.style.display = 'block';
    statusText.textContent = 'Đang bắt đầu tải...';
    progressBar.style.width = '0%';
    percentText.textContent = '0%';
    speedText.textContent = '';
    timeText.textContent = '';

    try {
        // Check if backend service is running
        const backendUrl = await getBackendUrl();
        
        if (!backendUrl) {
            // Try to download via extension download API (limited)
            await downloadViaExtension(url);
        } else {
            // Use backend service
            await downloadViaBackend(url, backendUrl);
        }
    } catch (error) {
        console.error('Download error:', error);
        showAlert('danger', `Lỗi: ${error.message}`);
        resetUI();
    }
}

// Get backend service URL
async function getBackendUrl() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['backendUrl'], (result) => {
            resolve(result.backendUrl || 'http://localhost:3000');
        });
    });
}

// Download via Extension Downloads API (limited functionality)
async function downloadViaExtension(url) {
    showAlert('info', 'Đang tải video... (Chế độ cơ bản)');
    
    // This is a fallback - browser extensions can't directly use yt-dlp
    // You need a backend service
    statusText.textContent = 'Cần backend service để tải video';
    showAlert('warning', 'Vui lòng chạy backend service (node server.js) để tải video!');
    resetUI();
}

// Download via Backend Service
async function downloadViaBackend(url, backendUrl) {
    try {
        statusText.textContent = 'Đang kết nối...';
        
        const response = await fetch(`${backendUrl}/api/download`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url: url,
                path: savePathInput.value || 'Downloads'
            })
        });

        if (!response.ok) {
            throw new Error('Không thể kết nối đến backend service. Vui lòng chạy: node server.js');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.substring(6));
                        if (data.type === 'progress') {
                            parseProgress(data.data);
                        } else if (data.type === 'complete') {
                            progressBar.style.width = '100%';
                            percentText.textContent = '100%';
                            statusText.textContent = 'Hoàn thành!';
                            showAlert('success', 'Tải video thành công!');
                            resetUI();
                            return;
                        } else if (data.type === 'error') {
                            throw new Error(data.data);
                        }
                    } catch (e) {
                        // If not JSON, treat as raw progress line
                        parseProgress(line);
                    }
                }
            }
        }

    } catch (error) {
        console.error('Backend download error:', error);
        throw error;
    } finally {
        if (isDownloading) {
            resetUI();
        }
    }
}

// Parse progress from yt-dlp output
function parseProgress(line) {
    // Format: [download]  45.2% of 123.45MiB at 1.23MiB/s ETA 00:45
    const percentMatch = line.match(/\[download\]\s+(\d+\.?\d*)%/);
    if (percentMatch) {
        const percent = parseFloat(percentMatch[1]);
        progressBar.style.width = `${percent}%`;
        percentText.textContent = `${percent.toFixed(1)}%`;
        statusText.textContent = `Đang tải: ${percent.toFixed(1)}%`;
    }

    const speedMatch = line.match(/at\s+([\d.]+)(\w+)\/s/);
    const etaMatch = line.match(/ETA\s+(\d+):(\d+)/);

    if (speedMatch) {
        speedText.textContent = `Tốc độ: ${speedMatch[1]} ${speedMatch[2]}/s`;
    }

    if (etaMatch) {
        timeText.textContent = `Còn lại: ${etaMatch[1]}:${etaMatch[2]}`;
    }
}

// Show alert message
function showAlert(type, message) {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    alertContainer.appendChild(alertDiv);

    // Auto remove after 5 seconds
    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}

// Reset UI
function resetUI() {
    isDownloading = false;
    downloadBtn.disabled = false;
    downloadBtn.innerHTML = '<i class="bi bi-download"></i> Tải Video';
    
    if (downloadInterval) {
        clearInterval(downloadInterval);
        downloadInterval = null;
    }
}

