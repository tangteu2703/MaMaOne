// ==========================================
// RENDER AI STUDIO — CLIENT JS (RenderAI.html)
// Handles Render AI requests, Line-by-Line workflow updates, and video preview
// ==========================================

let ws = null;

// DOM Elements - General
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const formRenderAI = document.getElementById('form-render-ai');
const aiTopicInput = document.getElementById('ai-topic');
const btnPresets = document.querySelectorAll('.btn-preset');
const aiTerminalMini = document.getElementById('ai-terminal-mini');

// Line 1 Elements (Script & Image Generation)
const line1StatusBadge = document.getElementById('ai-img-count-badge');
const line1ProgressContainer = document.getElementById('line1-progress-container');
const line1StatusLabel = document.getElementById('line1-status-label');
const line1PercentLabel = document.getElementById('line1-percent-label');
const line1ProgressFill = document.getElementById('line1-progress-fill');
const aiGalleryGrid = document.getElementById('ai-gallery-grid');

// Line 2 Elements (TTS Voiceover)
const line2StatusBadge = document.getElementById('line2-status-badge');
const line2ScriptText = document.getElementById('line2-script-text');
const line2AudioPlayer = document.getElementById('line2-audio-player');

// Line 3 Elements (FFmpeg Video Export)
const line3StatusBadge = document.getElementById('line3-status-badge');
const aiVideoPlayer = document.getElementById('ai-video-player');
const aiResTitle = document.getElementById('ai-res-title');
const aiResCaption = document.getElementById('ai-res-caption');
const aiVideoDownload = document.getElementById('ai-video-download');

document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) lucide.createIcons();
  connectWebSocket();
  initFormAndPresets();
  checkComfyUIBadge();
  initTerminalToggle();
  initTabNavigation();
  fetchVideoHistoryList();

  const btnRefresh = document.getElementById('btn-refresh-history');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', fetchVideoHistoryList);
  }
});

function initTerminalToggle() {
  const btn = document.getElementById('btn-toggle-log-size');
  const term = document.getElementById('ai-terminal-mini');
  if (!btn || !term) return;

  let isMax = false;
  btn.addEventListener('click', () => {
    isMax = !isMax;
    if (isMax) {
      term.className = 'h-[700px] overflow-y-auto p-5 font-mono text-sm bg-slate-950 rounded-xl border border-slate-800/90 text-slate-200 space-y-2 leading-relaxed shadow-2xl transition-all duration-300';
      btn.querySelector('span').textContent = 'Thu Nhỏ';
    } else {
      term.className = 'h-[420px] overflow-y-auto p-5 font-mono text-sm bg-slate-950 rounded-xl border border-slate-800/90 text-slate-200 space-y-2 leading-relaxed shadow-inner transition-all duration-300';
      btn.querySelector('span').textContent = 'Phóng To';
    }
  });
}

async function checkComfyUIBadge() {
  const badge = document.getElementById('comfy-status-badge');
  if (!badge) return;
  try {
    const res = await fetch('/api/ai-generator/comfy-status');
    const data = await res.json();
    if (data.online) {
      badge.textContent = 'ComfyUI Local: Online (Sẵn sàng 0đ)';
      badge.className = 'text-[11px] px-2.5 py-0.5 rounded-full font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
    } else {
      badge.textContent = 'ComfyUI: Offline (Dùng Motion Fallback)';
      badge.className = 'text-[11px] px-2.5 py-0.5 rounded-full font-mono bg-amber-500/10 text-amber-400 border border-amber-500/30';
    }
  } catch {
    badge.textContent = 'ComfyUI: Standalone Mode';
  }
}

// 1. WebSocket Connection
function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    setStatus('online', 'Đang Chờ (Idle)');
    appendLog('[INFO] [Dashboard] Đã kết nối thành công tới Render AI Server!');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWSMessage(msg);
    } catch (e) {
      console.error('Lỗi parse WS data:', e);
    }
  };

  ws.onclose = () => {
    setStatus('offline', 'Mất kết nối');
    appendLog('[WARN] [Dashboard] Mất kết nối WS. Đang thử lại trong 3 giây...');
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = () => {
    setStatus('offline', 'Lỗi kết nối');
  };
}

function setStatus(type, text) {
  if (!statusDot || !statusText) return;
  statusText.textContent = text;
  if (type === 'online') {
    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 pulse-dot';
  } else if (type === 'running') {
    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400 pulse-dot';
  } else {
    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500';
  }
}

function handleWSMessage(msg) {
  switch (msg.type) {
    case 'log':
      if (msg.data && msg.data.message) {
        appendLog(`[${msg.data.level || 'INFO'}] [${msg.data.module || 'System'}] ${msg.data.message}`);
      }
      break;
    case 'progress':
      updateProgress(msg.data);
      break;
    case 'ai_image_step_created':
      handleStepImageLiveUpdate(msg.data);
      break;
    case 'ai_video_created':
      handleAIVideoResult(msg.data);
      fetchVideoHistoryList();
      break;
    case 'history_update':
      fetchVideoHistoryList();
      break;
    case 'state_change':
      if (msg.data.isRunning) {
        setStatus('running', msg.data.currentStep || 'Đang xử lý...');
      } else {
        setStatus('online', 'Đang Chờ (Idle)');
      }
      break;
  }
}

function appendLog(text) {
  if (!aiTerminalMini) return;
  const line = document.createElement('div');
  line.textContent = text;
  if (text.includes('[ERROR]')) line.className = 'text-rose-400 font-semibold';
  else if (text.includes('[SUCCESS]')) line.className = 'text-emerald-400';
  else if (text.includes('[WARN]')) line.className = 'text-amber-400';
  else line.className = 'text-slate-400';

  aiTerminalMini.appendChild(line);
  aiTerminalMini.scrollTop = aiTerminalMini.scrollHeight;
}

// 2. Form & Presets Handler
function initFormAndPresets() {
  if (btnPresets) {
    btnPresets.forEach(btn => {
      btn.addEventListener('click', () => {
        if (aiTopicInput) aiTopicInput.value = btn.dataset.preset;
      });
    });
  }

  if (formRenderAI) {
    formRenderAI.addEventListener('submit', async (e) => {
      e.preventDefault();
      const topic = aiTopicInput.value.trim();
      const stepCount = document.getElementById('ai-step-count').value;
      const isVertical = document.getElementById('ai-aspect-ratio').value === 'vertical';

      if (!topic) {
        alert('Vui lòng nhập chủ đề video!');
        return;
      }

      // Reset Line 1 UI
      if (line1StatusBadge) line1StatusBadge.textContent = `0/${stepCount} Ảnh HD`;
      if (line1ProgressContainer) line1ProgressContainer.classList.remove('hidden');
      if (line1ProgressFill) line1ProgressFill.style.width = '5%';
      if (line1PercentLabel) line1PercentLabel.textContent = '5%';
      if (line1StatusLabel) line1StatusLabel.textContent = 'Đang khởi tạo kịch bản Gemini...';

      if (aiGalleryGrid) {
        aiGalleryGrid.innerHTML = `
          <div class="col-span-full py-12 text-center text-slate-400 text-xs">
            <i data-lucide="loader-2" class="w-8 h-8 mx-auto mb-2 animate-spin text-amber-400"></i>
            LINE 1: Đang tạo kịch bản đồng nhất & sinh chuỗi ảnh giai đoạn...
          </div>
        `;
        if (window.lucide) lucide.createIcons();
      }

      // Reset Line 2 UI
      const line2StepsGrid = document.getElementById('line2-steps-grid');
      if (line2StepsGrid) {
        line2StepsGrid.innerHTML = `
          <div class="col-span-full py-6 text-center text-slate-500 text-xs italic">
            Đang chờ kịch bản phân đoạn từ Line 1...
          </div>
        `;
      }
      if (line2StatusBadge) {
        line2StatusBadge.textContent = 'Đang chờ Line 1...';
        line2StatusBadge.className = 'px-3.5 py-1 text-xs font-bold bg-slate-800 text-slate-400 rounded-full';
      }
      if (line2ScriptText) line2ScriptText.textContent = 'Đang chờ tạo kịch bản...';
      if (line2AudioPlayer) line2AudioPlayer.removeAttribute('src');

      // Reset Line 3 UI
      if (line3StatusBadge) {
        line3StatusBadge.textContent = 'Đang chờ Line 2...';
        line3StatusBadge.className = 'px-3.5 py-1 text-xs font-bold bg-slate-800 text-slate-400 rounded-full';
      }
      if (aiResTitle) aiResTitle.textContent = 'Chưa có video render';
      if (aiResCaption) aiResCaption.textContent = '';
      if (aiVideoPlayer) aiVideoPlayer.removeAttribute('src');

      const renderMode = document.getElementById('ai-render-mode') ? document.getElementById('ai-render-mode').value : 'motion';

      try {
        appendLog(`[INFO] [RenderAI] Kích hoạt Pipeline (Mode: ${renderMode}) cho chủ đề: "${topic.substring(0, 40)}..."`);
        const res = await fetch('/api/ai-generator/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic, stepCount, isVertical, renderMode }),
        });
        const data = await res.json();
        if (!data.success) {
          alert(data.message || 'Lỗi kích hoạt Render AI Video');
        }
      } catch (err) {
        alert('Lỗi gửi yêu cầu: ' + err.message);
      }
    });
  }
}

// 3. Progress Update per Step
function updateProgress(data) {
  const progressData = data.data || data;

  if (progressData.stepName) {
    if (progressData.step === 3) {
      // Line 2: TTS Voice
      if (line2StatusBadge) {
        line2StatusBadge.textContent = 'Đang render giọng đọc AI...';
        line2StatusBadge.className = 'px-3.5 py-1 text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded-full animate-pulse';
      }
    } else if (progressData.step === 4) {
      // Line 3: FFmpeg Video
      if (line3StatusBadge) {
        line3StatusBadge.textContent = 'Đang dựng Video Slideshow...';
        line3StatusBadge.className = 'px-3.5 py-1 text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full animate-pulse';
      }
    }
  }
}

// 4. Line 1: Real-time Step Image Streaming
function handleStepImageLiveUpdate(data) {
  if (!aiGalleryGrid) return;
  const { currentStepIndex, totalSteps, image } = data;

  // Clear loader / empty placeholder if present
  if (aiGalleryGrid.querySelector('.py-12')) {
    aiGalleryGrid.innerHTML = '';
  }

  const percent = Math.round((currentStepIndex / totalSteps) * 100);
  if (line1ProgressFill) line1ProgressFill.style.width = `${percent}%`;
  if (line1PercentLabel) line1PercentLabel.textContent = `${percent}%`;
  if (line1StatusLabel) line1StatusLabel.textContent = `Đã render ảnh Bước ${currentStepIndex}/${totalSteps}`;

  if (line1StatusBadge) {
    line1StatusBadge.textContent = `${currentStepIndex}/${totalSteps} Ảnh HD`;
    if (currentStepIndex === totalSteps) {
      line1StatusBadge.textContent = `Hoàn tất Line 1 (${totalSteps}/${totalSteps} Ảnh)`;
      line1StatusBadge.className = 'px-3.5 py-1 text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full';
    }
  }

  // 1. Cập nhật Thẻ Ảnh Line 1
  let card = document.getElementById(`ai-step-card-${image.step}`);
  if (!card) {
    card = document.createElement('div');
    card.id = `ai-step-card-${image.step}`;
    card.className = 'glass-card rounded-xl overflow-hidden border border-amber-500/60 p-2.5 space-y-2 hover:border-amber-400 transition shadow-lg animate__animated animate__fadeInUp';
    aiGalleryGrid.appendChild(card);
  }

  card.innerHTML = `
    <div class="relative bg-black aspect-[9/16] min-h-[260px] rounded-lg overflow-hidden border border-slate-800">
      <img src="${image.publicUrl}" alt="${image.title}" class="w-full h-full object-cover hover:scale-105 transition duration-300">
      <span class="absolute top-2 left-2 bg-slate-950/80 backdrop-blur-md px-2.5 py-1 text-xs font-bold text-amber-400 rounded-md border border-amber-500/30">BƯỚC ${image.step}</span>
    </div>
    <p class="text-xs font-bold text-white truncate mt-1" title="${image.title}">${image.title}</p>
    <p class="text-[11px] text-slate-300 line-clamp-2 leading-relaxed" title="${image.narration}">${image.narration}</p>
  `;

  // 2. Cập nhật Thẻ Thuyết Minh Lời Thoại Bước Khớp 1:1 ở Line 2
  const line2StepsGrid = document.getElementById('line2-steps-grid');
  if (line2StepsGrid) {
    if (line2StepsGrid.querySelector('.py-6')) {
      line2StepsGrid.innerHTML = '';
    }

    let narrationCard = document.getElementById(`line2-step-card-${image.step}`);
    if (!narrationCard) {
      narrationCard = document.createElement('div');
      narrationCard.id = `line2-step-card-${image.step}`;
      narrationCard.className = 'bg-slate-950/90 p-3.5 rounded-xl border border-cyan-500/40 space-y-1.5 hover:border-cyan-400 transition shadow-lg animate__animated animate__fadeInUp';
      line2StepsGrid.appendChild(narrationCard);
    }

    narrationCard.innerHTML = `
      <div class="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
        <span class="text-[10px] font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">BƯỚC ${image.step}</span>
        <span class="text-[10px] text-slate-400 font-semibold truncate max-w-[110px]" title="${image.title}">${image.title}</span>
      </div>
      <p class="text-xs text-slate-200 leading-relaxed font-sans line-clamp-3 mt-1" title="${image.narration}">"${image.narration}"</p>
    `;
  }

  appendLog(`[SUCCESS] [Line 1 & 2] Đã render xong Ảnh + Thuyết Minh Bước ${image.step}/${totalSteps}: "${image.title}"`);
}

// 5. Complete Pipeline Result Display (Lines 1, 2, 3 Done)
function handleAIVideoResult(result) {
  // Update Line 1 Badge
  if (line1StatusBadge) {
    line1StatusBadge.textContent = `Hoàn tất Line 1 (${result.images.length}/${result.images.length} Ảnh)`;
    line1StatusBadge.className = 'px-3.5 py-1 text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full';
  }

  // Update Line 2 UI (Voiceover Audio)
  if (line2StatusBadge) {
    line2StatusBadge.textContent = 'Hoàn tất Line 2 (Audio OK)';
    line2StatusBadge.className = 'px-3.5 py-1 text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full';
  }
  if (line2ScriptText) {
    line2ScriptText.textContent = result.script || 'Đã tạo xong thuyết minh';
  }
  if (line2AudioPlayer) {
    line2AudioPlayer.src = `/audio/${result.videoId}.mp3`;
    line2AudioPlayer.play().catch(() => {});
  }

  // Update Line 3 UI (FFmpeg Video MP4)
  if (line3StatusBadge) {
    line3StatusBadge.textContent = 'Hoàn tất Line 3 (Video MP4 OK)';
    line3StatusBadge.className = 'px-3.5 py-1 text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full';
  }
  if (aiResTitle) aiResTitle.textContent = result.title || 'Video AI Hoàn Tất';
  if (aiResCaption) aiResCaption.textContent = result.caption || '';
  if (aiVideoPlayer) {
    aiVideoPlayer.src = result.videoUrl;
    aiVideoPlayer.play().catch(() => {});
  }
  if (aiVideoDownload) {
    aiVideoDownload.href = result.videoUrl;
  }

  appendLog(`[SUCCESS] [Line 3] Render xong Video MP4 hoàn chỉnh: ${result.videoId}_final.mp4`);
  fetchVideoHistoryList();
}

// 6. Video Library & History Gallery (Order By Date Desc / Asc)
let currentHistoryCache = { history: [], videos: [] };

function initTabNavigation() {
  const btnStudio = document.getElementById('tab-btn-studio');
  const btnLibrary = document.getElementById('tab-btn-library');
  const tabStudio = document.getElementById('view-tab-studio');
  const tabLibrary = document.getElementById('view-tab-library');
  const libraryControls = document.getElementById('tab-library-controls');
  const sortSelect = document.getElementById('history-sort-order');
  const searchInput = document.getElementById('history-search-input');

  if (!btnStudio || !btnLibrary) return;

  btnStudio.addEventListener('click', () => {
    btnStudio.className = 'px-6 py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-lg transition flex items-center gap-2';
    btnLibrary.className = 'px-6 py-3 rounded-xl text-sm font-bold text-slate-300 hover:text-white hover:bg-slate-800/80 transition flex items-center gap-2';
    if (tabStudio) tabStudio.classList.remove('hidden');
    if (tabLibrary) tabLibrary.classList.add('hidden');
    if (libraryControls) libraryControls.classList.add('hidden');
  });

  btnLibrary.addEventListener('click', () => {
    btnLibrary.className = 'px-6 py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-lg transition flex items-center gap-2';
    btnStudio.className = 'px-6 py-3 rounded-xl text-sm font-bold text-slate-300 hover:text-white hover:bg-slate-800/80 transition flex items-center gap-2';
    if (tabLibrary) tabLibrary.classList.remove('hidden');
    if (tabStudio) tabStudio.classList.add('hidden');
    if (libraryControls) libraryControls.classList.remove('hidden');
    fetchVideoHistoryList();
  });

  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      renderVideoHistoryList(currentHistoryCache.history, currentHistoryCache.videos);
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderVideoHistoryList(currentHistoryCache.history, currentHistoryCache.videos);
    });
  }
}

async function fetchVideoHistoryList() {
  const grid = document.getElementById('ai-video-history-grid');
  if (!grid) return;
  try {
    const res = await fetch('/api/videos');
    const data = await res.json();
    if (data.success) {
      currentHistoryCache = { history: data.history || [], videos: data.videos || [] };
      renderVideoHistoryList(data.history || [], data.videos || []);
    }
  } catch (err) {
    console.error('Lỗi fetch video history:', err);
  }
}

function renderVideoHistoryList(historyList = [], mp4Files = []) {
  const grid = document.getElementById('ai-video-history-grid');
  const countBadge = document.getElementById('tab-library-count');
  if (!grid) return;

  const combined = [];
  const historyMap = new Map();
  historyList.forEach(h => historyMap.set(h.videoFile || `/output/${h.id}_final.mp4`, h));

  mp4Files.forEach(f => {
    const matched = historyMap.get(f.url);
    if (matched) {
      combined.push(matched);
      historyMap.delete(f.url);
    } else {
      combined.push({
        id: f.filename.replace('.mp4', ''),
        time: f.createdAt,
        title: f.filename,
        caption: `#aivideo #tiktok #viral`,
        videoFile: f.url,
      });
    }
  });

  historyMap.forEach(h => combined.push(h));

  if (countBadge) countBadge.textContent = combined.length;

  if (combined.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full py-12 text-center text-slate-500 text-xs italic">
        Chưa có video nào trong lịch sử render...
      </div>
    `;
    return;
  }

  // ORDER BY DATE SORTING
  const sortOrder = document.getElementById('history-sort-order') ? document.getElementById('history-sort-order').value : 'desc';
  combined.sort((a, b) => {
    const dateA = new Date(a.time || 0).getTime() || 0;
    const dateB = new Date(b.time || 0).getTime() || 0;
    return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
  });

  // SEARCH FILTERING
  const query = document.getElementById('history-search-input') ? document.getElementById('history-search-input').value.toLowerCase().trim() : '';
  let filtered = combined;
  if (query) {
    filtered = combined.filter(item => 
      (item.title && item.title.toLowerCase().includes(query)) ||
      (item.caption && item.caption.toLowerCase().includes(query)) ||
      (item.time && item.time.toLowerCase().includes(query))
    );
  }

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full py-12 text-center text-amber-400/80 text-xs font-semibold">
        Không tìm thấy video nào phù hợp với từ khóa "${query}"
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(item => `
    <div class="glass-card rounded-2xl overflow-hidden border border-slate-800 p-4 space-y-3 hover:border-amber-500/40 transition shadow-xl flex flex-col justify-between">
      <div class="space-y-2">
        <div class="aspect-[9/16] max-h-[280px] bg-black rounded-xl overflow-hidden border border-slate-800 mx-auto w-full">
          <video src="${item.videoFile}" controls class="w-full h-full object-contain"></video>
        </div>
        <div class="space-y-1">
          <div class="flex items-center justify-between text-[11px] text-slate-400 font-mono">
            <span>📅 ${item.time || 'vừa xong'}</span>
            <span class="text-emerald-400 font-bold">✅ Render AI MP4</span>
          </div>
          <h4 class="text-sm font-bold text-white line-clamp-2">${item.title || 'Video Render AI'}</h4>
        </div>

        <div class="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1 text-xs">
          <span class="text-[10px] text-indigo-400 font-bold uppercase tracking-wider">Caption & Hashtags TikTok:</span>
          <p class="text-slate-300 font-mono text-[11px] leading-relaxed line-clamp-3">${item.caption || '#aivideo #tiktok'}</p>
        </div>
      </div>

      <div class="flex items-center gap-2 pt-2 border-t border-slate-800/80">
        <button onclick="copyToClipboard('${(item.caption || '').replace(/'/g, "\\'")}')" class="flex-1 py-2 px-3 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold flex items-center justify-center gap-1.5 transition">
          <i data-lucide="copy" class="w-3.5 h-3.5"></i>
          <span>Copy Caption</span>
        </button>
        <a href="${item.videoFile}" download class="py-2 px-3 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-xs font-semibold flex items-center justify-center gap-1 transition">
          <i data-lucide="download" class="w-3.5 h-3.5"></i>
          <span>Tải MP4</span>
        </a>
      </div>
    </div>
  `).join('');

  if (window.lucide) lucide.createIcons();
}

function copyToClipboard(text) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    alert('Đã copy Caption & Hashtags TikTok vào Clipboard!');
  }).catch(() => {
    alert('Copy thất bại: ' + text);
  });
}
