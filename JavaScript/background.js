// Background Service Worker for Chrome Extension

chrome.runtime.onInstalled.addListener(() => {
    console.log('Video Downloader Extension installed');
    
    // Set default backend URL
    chrome.storage.local.set({
        backendUrl: 'http://localhost:3000',
        savePath: 'Downloads'
    });
});

// Listen for messages from popup or content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'download') {
        handleDownload(request.url, request.path)
            .then(result => sendResponse({ success: true, result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep channel open for async response
    }
});

// Handle download
async function handleDownload(url, path) {
    try {
        // Get backend URL from storage
        const result = await chrome.storage.local.get(['backendUrl']);
        const backendUrl = result.backendUrl || 'http://localhost:3000';
        
        // Call backend API
        const response = await fetch(`${backendUrl}/api/download`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url, path })
        });

        if (!response.ok) {
            throw new Error('Backend service không phản hồi');
        }

        return await response.json();
    } catch (error) {
        console.error('Download error:', error);
        throw error;
    }
}

