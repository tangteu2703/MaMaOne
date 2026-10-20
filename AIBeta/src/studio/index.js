// ==========================================
// STUDIO — điểm gắn vào server.js
//   require('./src/studio').mount(app, { imageProviders, imageStyles, port })
//
// Cấu trúc:
//   storySpec.js     đọc truyện JSON/TXT → segments
//   jobStore.js      lưu job, thư viện truyện, view cho UI
//   pipeline.js      hàng đợi + điều phối 4 bước + pause/resume
//   steps/           voiceStep → planStep → imageStep → subtitleStep → renderStep
//   videoBuilder.js  dựng clip Ken Burns + ghép cuối (FFmpeg)
//   motions.js       12 kiểu zoom/pan   subtitles.js  tạo ASS   mediaUtils.js  tiện ích FFmpeg
// ==========================================
const path = require('path');
const express = require('express');
const deps = require('./deps');
const store = require('./jobStore');
const { createRouter } = require('./routes');

function mount(app, { imageProviders, imageStyles, port }) {
  deps.init({ imageProviders, imageStyles, port });
  app.use('/api/studio', createRouter());
  app.use('/studio-files', express.static(store.JOBS_DIR));
  app.get('/studio', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
  });
}

module.exports = { mount };
