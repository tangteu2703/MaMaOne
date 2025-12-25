// Content Script - Chạy trên các trang web

// Detect video URLs and show download button
(function() {
    'use strict';

    // Check if current page is a video platform
    const currentUrl = window.location.href;
    const videoDomains = [
        'youtube.com', 'youtu.be',
        'tiktok.com', 'vm.tiktok.com',
        'douyin.com'
    ];

    const isVideoPage = videoDomains.some(domain => currentUrl.includes(domain));

    if (isVideoPage) {
        // Send URL to extension
        chrome.runtime.sendMessage({
            action: 'videoDetected',
            url: currentUrl
        });
    }
})();

