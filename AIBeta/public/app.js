// ==========================================
// TIKTOK AUTO DASHBOARD — CLIENT JS
// Realtime Progress Monitor + Scraped Queue & Script Lists
// ==========================================

let ws = null;
let autoScroll = true;
let chart = null;
let scrapedVideosQueue = [];
let translatedScriptsList = [];

// DOM Elements - Global
const systemStatusPill = document.getElementById('system-status-pill');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const btnRunPipeline = document.getElementById('btn-run-pipeline');
const terminalLogs = document.getElementById('terminal-logs');
const chkAutoScroll = document.getElementById('chk-autoscroll');
const btnClearLogs = document.getElementById('btn-clear-logs');

// Stats
const statTotal = document.getElementById('stat-total');
const statSuccess = document.getElementById('stat-success');
const statFailed = document.getElementById('stat-failed');

// Progress Banner
const pipelineProgressCard = document.getElementById('pipeline-progress-card');
const currentStepLabel = document.getElementById('current-step-label');
const progressBarFill = document.getElementById('progress-bar-fill');
const progressPercent = document.getElementById('progress-percent');

// REALTIME PROGRESS TAB ELEMENTS
const liveProgressBadge = document.getElementById('live-progress-badge');
const prgQueueStatus = document.getElementById('prg-queue-status');
const prgVideoId = document.getElementById('prg-video-id');
const prgVideoTitle = document.getElementById('prg-video-title');
const prgVideoAuthor = document.getElementById('prg-video-author');
const prgTimerElapsed = document.getElementById('prg-timer-elapsed');
const prgTimerEta = document.getElementById('prg-timer-eta');
const prgOverallBar = document.getElementById('prg-overall-bar');
const prgOverallPercent = document.getElementById('prg-overall-percent');
const scriptPreviewTitle = document.getElementById('script-preview-title');
const scriptPreviewBody = document.getElementById('script-preview-body');
const scriptStatusTag = document.getElementById('script-status-tag');

// TABLES
const scrapedQueueTbody = document.getElementById('scraped-queue-tbody');
const scriptPreviewContainer = document.getElementById('script-preview-container');

// Config Form
const formConfig = document.getElementById('form-config');
const inputApify = document.getElementById('input-apify');
const inputGemini = document.getElementById('input-gemini');
const inputHashtags = document.getElementById('input-hashtags');
const inputMaxVideos = document.getElementById('input-max-videos');
const inputMinViews = document.getElementById('input-min-views');
const inputVoice = document.getElementById('input-voice');
const saveStatus = document.getElementById('save-status');

// Video Grid
const videoGrid = document.getElementById('video-grid');
const videoCountBadge = document.getElementById('video-count-badge');
const btnRefreshVideos = document.getElementById('btn-refresh-videos');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) lucide.createIcons();
  initTabs();
  initAnalyticsChart();
  connectWebSocket();
  loadConfig();
  loadVideos();
  syncPipelineFiles();
  initStoryTab();

  // Event Listeners
  btnRunPipeline.addEventListener('click', confirmRunPipeline);
  btnClearLogs.addEventListener('click', clearLogs);
  chkAutoScroll.addEventListener('change', (e) => { autoScroll = e.target.checked; });
  formConfig.addEventListener('submit', saveConfig);
  btnRefreshVideos.addEventListener('click', loadVideos);
});

// 1. WebSocket Setup
function connectWebSocket() {
  // Fallback về localhost:3000 nếu mở bằng file:// (host sẽ rỗng)
  const host = location.host || 'localhost:3000';
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${host}`;

  try {
    ws = new WebSocket(wsUrl);
  } catch (e) {
    setStatus('offline', 'Không thể kết nối');
    setTimeout(connectWebSocket, 5000);
    return;
  }

  ws.onopen = () => {
    setStatus('online', 'Đang Chờ (Idle)');
    appendLog({ level: 'INFO', module: 'Dashboard', message: 'Đã kết nối với Web Dashboard Server!' });
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
    setStatus('offline', 'Mất Kết Nối');
    appendLog({ level: 'WARN', module: 'Dashboard', message: 'Mất kết nối với Server. Đang thử lại trong 3s...' });
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = () => {
    setStatus('offline', 'Lỗi Kết Nối');
  };
}

// Handle Incoming WS Messages
function handleWSMessage(msg) {
  switch (msg.type) {
    case 'init':
      updateState(msg.data.state);
      if (msg.data.recentLogs) {
        terminalLogs.innerHTML = '';
        msg.data.recentLogs.forEach(appendLog);
      }
      if (msg.data.config) populateConfig(msg.data.config);
      if (msg.data.activeProgress) updateRealtimeProgress(msg.data.activeProgress);
      break;

    case 'log':
      appendLog(msg.data);
      break;

    case 'state_change':
      updateState(msg.data);
      break;

    case 'progress':
      updateRealtimeProgress(msg.data.data || msg.data);
      break;
    case 'history_update':
      if (Array.isArray(msg.data)) {
        msg.data.forEach(item => {
          if (item && item.id) {
            const existing = masterVideoMap.get(item.id) || {};
            masterVideoMap.set(item.id, {
              ...existing,
              id: item.id,
              author: existing.author || 'Tập ' + (parseInt(item.id.replace('ep', '')) || 1),
              desc: item.title || existing.desc || 'Tập truyện',
              scriptTitle: item.title || existing.scriptTitle || 'Tập truyện',
              scriptBody: item.script || item.caption || existing.scriptBody,
              videoFile: item.videoFile || existing.videoFile,
              finalFile: item.videoFile ? item.videoFile.replace('/output/', '') : existing.finalFile,
              finalVideoState: 'done',
              status: item.status || 'success',
            });
          }
        });
        renderMasterTable();
      }
      break;

    case 'ai_video_created':
      handleAIVideoResult(msg.data);
      break;

    case 'config_updated':
      populateConfig(msg.data);
      break;

    case 'story_updated':
      loadStory();
      break;
  }
}

// Update Status Pill & Stats
function setStatus(type, text) {
  statusText.textContent = text;

  if (type === 'running') {
    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-cyan-400 pulse-dot shadow-[0_0_10px_#06b6d4]';
    systemStatusPill.className = 'flex items-center gap-2 px-3.5 py-2 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-xs font-medium text-cyan-300';
  } else if (type === 'online') {
    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981]';
    systemStatusPill.className = 'flex items-center gap-2 px-3.5 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-xs font-medium text-emerald-300';
  } else {
    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-slate-500';
    systemStatusPill.className = 'flex items-center gap-2 px-3.5 py-2 rounded-full bg-slate-800/80 border border-slate-700/60 text-xs font-medium text-slate-400';
  }
}

function updateState(state) {
  if (!state) return;

  if (state.isRunning) {
    setStatus('running', 'Đang Chạy Pipeline...');
    btnRunPipeline.disabled = true;
    btnRunPipeline.classList.add('opacity-50', 'cursor-not-allowed');
    pipelineProgressCard.classList.remove('hidden');
  } else {
    setStatus('online', 'Đang Chờ (Idle)');
    btnRunPipeline.disabled = false;
    btnRunPipeline.classList.remove('opacity-50', 'cursor-not-allowed');
    pipelineProgressCard.classList.add('hidden');
  }

  if (state.stats) {
    statTotal.textContent = state.stats.processedToday || 0;
    statSuccess.textContent = state.stats.successToday || 0;
    statFailed.textContent = state.stats.failedToday || 0;
  }
}

// UPDATE REALTIME PROGRESS TAB & LISTS
function updateRealtimeProgress(data) {
  if (!data) return;

  // 1. Overall Progress & Timers
  const overallPct = data.overallPercent || 0;
  liveProgressBadge.textContent = `${overallPct}%`;
  prgOverallPercent.textContent = `${overallPct}%`;
  prgOverallBar.style.width = `${overallPct}%`;

  progressBarFill.style.width = `${overallPct}%`;
  progressPercent.textContent = `${overallPct}%`;
  currentStepLabel.textContent = `[Video ${data.videoIndex || 1}/${data.totalVideos || 1}] ${data.stepName}: ${data.details || ''}`;

  prgQueueStatus.textContent = `Đang Xử Lý Video ${data.videoIndex || 1}/${data.totalVideos || 1}`;
  prgVideoId.textContent = `ID: ${data.videoId || '--'}`;
  prgVideoTitle.textContent = data.scriptTitle || data.videoDesc || 'Đang xử lý video...';
  prgVideoAuthor.textContent = `Tác giả gốc: @${data.videoAuthor || 'unknown'} | ${data.videoDesc ? data.videoDesc.substring(0, 70) + '...' : ''}`;

  // Timers Format
  prgTimerElapsed.textContent = formatTime(data.elapsedSeconds || 0);
  prgTimerEta.textContent = formatEta(data.etaSeconds || 0);

  // 2. Step Cards Update (1 to 5)
  const currentStep = data.step || 0;

  for (let s = 1; s <= 5; s++) {
    const card = document.getElementById(`step-card-${s}`);
    const badge = document.getElementById(`step-badge-${s}`);
    const bar = document.getElementById(`step-bar-${s}`);
    const desc = document.getElementById(`step-desc-${s}`);

    if (!card || !badge || !bar) continue;

    if (s < currentStep) {
      card.className = 'glass-card rounded-xl p-4 border border-emerald-500/40 bg-emerald-950/20 flex flex-col justify-between space-y-3 opacity-100 transition-all';
      badge.className = 'text-[10px] font-bold px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded-full border border-emerald-500/30';
      badge.textContent = '✅ Xong';
      bar.className = 'bg-emerald-400 h-full transition-all duration-300';
      bar.style.width = '100%';
    } else if (s === currentStep) {
      card.className = 'glass-card rounded-xl p-4 border border-cyan-400 bg-cyan-950/30 flex flex-col justify-between space-y-3 opacity-100 shadow-[0_0_15px_rgba(6,182,212,0.2)] transition-all';
      badge.className = 'text-[10px] font-bold px-2 py-0.5 bg-cyan-500/20 text-cyan-300 rounded-full border border-cyan-500/30 pulse-dot';
      badge.textContent = `⚡ ${data.stepPercent || 50}%`;
      bar.className = 'bg-gradient-to-r from-indigo-500 to-cyan-400 h-full transition-all duration-300';
      bar.style.width = `${data.stepPercent || 50}%`;
      if (desc && data.details) desc.textContent = data.details;
    } else {
      card.className = 'glass-card rounded-xl p-4 border border-slate-800 flex flex-col justify-between space-y-3 opacity-40 transition-all';
      badge.className = 'text-[10px] font-bold px-2 py-0.5 bg-slate-800 text-slate-400 rounded-full';
      badge.textContent = 'Chờ';
      bar.className = 'bg-slate-700 h-full transition-all duration-300';
      bar.style.width = '0%';
    }
  }

  // 3. Update Master Pipeline Table State
  updateMasterVideoState(data);
}


// 1. WebSocket Setup
function connectWebSocket() {
  // Fallback về localhost:3000 nếu mở bằng file:// (host sẽ rỗng)
  const host = location.host || 'localhost:3000';
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${host}`;

  try {
    ws = new WebSocket(wsUrl);
  } catch (e) {
    setStatus('offline', 'Không thể kết nối');
    setTimeout(connectWebSocket, 5000);
    return;
  }

  ws.onopen = () => {
    setStatus('online', 'Đang Chờ (Idle)');
    appendLog({ level: 'INFO', module: 'Dashboard', message: 'Đã kết nối với Web Dashboard Server!' });
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
    setStatus('offline', 'Mất Kết Nối');
    appendLog({ level: 'WARN', module: 'Dashboard', message: 'Mất kết nối với Server. Đang thử lại trong 3s...' });
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = () => {
    setStatus('offline', 'Lỗi Kết Nối');
  };
}

// Handle Incoming WS Messages
function handleWSMessage(msg) {
  switch (msg.type) {
    case 'init':
      updateState(msg.data.state);
      if (msg.data.recentLogs) {
        terminalLogs.innerHTML = '';
        msg.data.recentLogs.forEach(appendLog);
      }
      if (msg.data.config) populateConfig(msg.data.config);
      if (msg.data.activeProgress) updateRealtimeProgress(msg.data.activeProgress);
      break;

    case 'log':
      appendLog(msg.data);
      break;

    case 'state_change':
      updateState(msg.data);
      break;

    case 'progress':
      updateRealtimeProgress(msg.data.data || msg.data);
      break;
    case 'history_update':
      if (Array.isArray(msg.data)) {
        msg.data.forEach(item => {
          if (item && item.id) {
            const existing = masterVideoMap.get(item.id) || {};
            masterVideoMap.set(item.id, {
              ...existing,
              id: item.id,
              author: existing.author || 'Tập ' + (parseInt(item.id.replace('ep', '')) || 1),
              desc: item.title || existing.desc || 'Tập truyện',
              scriptTitle: item.title || existing.scriptTitle || 'Tập truyện',
              scriptBody: item.script || item.caption || existing.scriptBody,
              videoFile: item.videoFile || existing.videoFile,
              finalFile: item.videoFile ? item.videoFile.replace('/output/', '') : existing.finalFile,
              finalVideoState: 'done',
              status: item.status || 'success',
            });
          }
        });
        renderMasterTable();
      }
      break;

    case 'ai_video_created':
      handleAIVideoResult(msg.data);
      break;

    case 'config_updated':
      populateConfig(msg.data);
      break;

    case 'story_updated':
      loadStory();
      break;
  }
}

// Update Status Pill & Stats
function setStatus(type, text) {
  statusText.textContent = text;

  if (type === 'running') {
    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-cyan-400 pulse-dot shadow-[0_0_10px_#06b6d4]';
    systemStatusPill.className = 'flex items-center gap-2 px-3.5 py-2 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-xs font-medium text-cyan-300';
  } else if (type === 'online') {
    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981]';
    systemStatusPill.className = 'flex items-center gap-2 px-3.5 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-xs font-medium text-emerald-300';
  } else {
    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-slate-500';
    systemStatusPill.className = 'flex items-center gap-2 px-3.5 py-2 rounded-full bg-slate-800/80 border border-slate-700/60 text-xs font-medium text-slate-400';
  }
}

function updateState(state) {
  if (!state) return;

  if (state.isRunning) {
    setStatus('running', 'Đang Chạy Pipeline...');
    btnRunPipeline.disabled = true;
    btnRunPipeline.classList.add('opacity-50', 'cursor-not-allowed');
    pipelineProgressCard.classList.remove('hidden');
  } else {
    setStatus('online', 'Đang Chờ (Idle)');
    btnRunPipeline.disabled = false;
    btnRunPipeline.classList.remove('opacity-50', 'cursor-not-allowed');
    pipelineProgressCard.classList.add('hidden');
  }

  if (state.stats) {
    statTotal.textContent = state.stats.processedToday || 0;
    statSuccess.textContent = state.stats.successToday || 0;
    statFailed.textContent = state.stats.failedToday || 0;
  }
}

// UPDATE REALTIME PROGRESS TAB & LISTS
function updateRealtimeProgress(data) {
  if (!data) return;

  // 1. Overall Progress & Timers
  const overallPct = data.overallPercent || 0;
  liveProgressBadge.textContent = `${overallPct}%`;
  prgOverallPercent.textContent = `${overallPct}%`;
  prgOverallBar.style.width = `${overallPct}%`;

  progressBarFill.style.width = `${overallPct}%`;
  progressPercent.textContent = `${overallPct}%`;
  currentStepLabel.textContent = `[Video ${data.videoIndex || 1}/${data.totalVideos || 1}] ${data.stepName}: ${data.details || ''}`;

  prgQueueStatus.textContent = `Đang Xử Lý Video ${data.videoIndex || 1}/${data.totalVideos || 1}`;
  prgVideoId.textContent = `ID: ${data.videoId || '--'}`;
  prgVideoTitle.textContent = data.scriptTitle || data.videoDesc || 'Đang xử lý video...';
  prgVideoAuthor.textContent = `Tác giả gốc: @${data.videoAuthor || 'unknown'} | ${data.videoDesc ? data.videoDesc.substring(0, 70) + '...' : ''}`;

  // Timers Format
  prgTimerElapsed.textContent = formatTime(data.elapsedSeconds || 0);
  prgTimerEta.textContent = formatEta(data.etaSeconds || 0);

  // 2. Step Cards Update (1 to 5)
  const currentStep = data.step || 0;

  for (let s = 1; s <= 5; s++) {
    const card = document.getElementById(`step-card-${s}`);
    const badge = document.getElementById(`step-badge-${s}`);
    const bar = document.getElementById(`step-bar-${s}`);
    const desc = document.getElementById(`step-desc-${s}`);

    if (!card || !badge || !bar) continue;

    if (s < currentStep) {
      card.className = 'glass-card rounded-xl p-4 border border-emerald-500/40 bg-emerald-950/20 flex flex-col justify-between space-y-3 opacity-100 transition-all';
      badge.className = 'text-[10px] font-bold px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded-full border border-emerald-500/30';
      badge.textContent = '✅ Xong';
      bar.className = 'bg-emerald-400 h-full transition-all duration-300';
      bar.style.width = '100%';
    } else if (s === currentStep) {
      card.className = 'glass-card rounded-xl p-4 border border-cyan-400 bg-cyan-950/30 flex flex-col justify-between space-y-3 opacity-100 shadow-[0_0_15px_rgba(6,182,212,0.2)] transition-all';
      badge.className = 'text-[10px] font-bold px-2 py-0.5 bg-cyan-500/20 text-cyan-300 rounded-full border border-cyan-500/30 pulse-dot';
      badge.textContent = `⚡ ${data.stepPercent || 50}%`;
      bar.className = 'bg-gradient-to-r from-indigo-500 to-cyan-400 h-full transition-all duration-300';
      bar.style.width = `${data.stepPercent || 50}%`;
      if (desc && data.details) desc.textContent = data.details;
    } else {
      card.className = 'glass-card rounded-xl p-4 border border-slate-800 flex flex-col justify-between space-y-3 opacity-40 transition-all';
      badge.className = 'text-[10px] font-bold px-2 py-0.5 bg-slate-800 text-slate-400 rounded-full';
      badge.textContent = 'Chờ';
      bar.className = 'bg-slate-700 h-full transition-all duration-300';
      bar.style.width = '0%';
    }
  }

  // 3. Update Master Pipeline Table State
  updateMasterVideoState(data);
}

let masterVideoMap = new Map();
let availableFiles = { downloads: [], outputs: [] };

async function syncPipelineFiles() {
  try {
    const res = await fetch('/api/pipeline-files');
    const data = await res.json();
    if (data.success) {
      availableFiles = data;
      renderMasterTable();
    }
  } catch (e) {
    console.error('Lỗi sync pipeline files:', e);
  }
}

function updateMasterVideoState(data) {
  if (!data || !data.videoId) return;

  const id = data.videoId;
  let video = masterVideoMap.get(id) || {
    id: id,
    author: data.videoAuthor || 'unknown',
    desc: data.videoDesc || 'N/A',
    views: '1,000,000+',
    step: 0,
    downloadState: 'pending',
    downloadFile: data.downloadFile || '',
    scriptState: 'pending',
    scriptTitle: '',
    scriptBody: '',
    voiceState: 'pending',
    finalVideoState: 'pending',
    finalFile: data.finalFile || '',
    uploadState: 'pending',
  };

  if (data.videoAuthor) video.author = data.videoAuthor;
  if (data.videoDesc) video.desc = data.videoDesc;
  if (data.downloadFile) video.downloadFile = data.downloadFile;
  if (data.finalFile) video.finalFile = data.finalFile;
  if (data.step) video.step = data.step;

  if (data.step === 1) {
    video.downloadState = data.stepPercent < 100 ? 'running' : 'done';
  } else if (data.step > 1) {
    video.downloadState = 'done';
  }

  if (data.scriptBody) video.scriptBody = data.scriptBody;
  if (data.scriptTitle) video.scriptTitle = data.scriptTitle;
  if (data.details && (data.details.includes('Kịch bản') || data.details.includes('dịch'))) {
    if (!video.scriptBody) video.scriptBody = data.details;
  }
  if (data.step === 2 || video.scriptBody) {
    video.scriptState = 'done';
  }

  if (data.step === 3) {
    video.voiceState = data.stepPercent < 100 ? 'running' : 'done';
  } else if (data.step > 3) {
    video.voiceState = 'done';
  }

  if (data.step === 4) {
    video.finalVideoState = data.stepPercent < 100 ? 'running' : 'done';
  } else if (data.step > 4) {
    video.finalVideoState = 'done';
  }

  if (data.step === 5) {
    video.uploadState = 'skipped';
  }

  masterVideoMap.set(id, video);
  renderMasterTable();
}


function findMatchingFileUrl(filesList, videoId) {
  if (!filesList || !filesList.length) return null;
  const match = filesList.find(f => f.filename.includes(videoId));
  return match ? match.url : null;
}

function renderMasterTable() {
  const tbody = document.getElementById('master-pipeline-tbody');
  if (!tbody) return;

  const videos = Array.from(masterVideoMap.values());
  if (videos.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="p-8 text-center text-slate-500 font-sans">
          Chưa có video nào trong danh sách. Bấm <b>"CHẠY PIPELINE NGAY"</b> để bắt đầu cào và xử lý video!
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = videos.map((v, i) => {
    // Tìm URL file video gốc & video output
    const downloadUrl = v.downloadFile ? (v.downloadFile.startsWith('/') ? v.downloadFile : `/downloads/${v.downloadFile}`) : null;
    const finalUrl = v.videoFile || (v.finalFile ? (v.finalFile.startsWith('/') ? v.finalFile : `/output/${v.finalFile}`) : null);

    // 1. Download Chip & Inline Player
    let downloadChip = '<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-slate-800 text-slate-400">⏳ Chờ</span>';
    if (v.downloadState === 'running') {
      downloadChip = '<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 pulse-dot">⚡ Đang cào/tải...</span>';
    } else if (v.downloadState === 'done' || downloadUrl) {
      downloadChip = '<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">✅ Đã tải video nền</span>';
    }

    let downloadPlayerHtml = '';
    if (downloadUrl) {
      downloadPlayerHtml = `
        <div class="relative bg-black rounded-xl overflow-hidden aspect-[9/16] w-36 max-h-56 mt-2 border border-slate-800 shadow-lg">
          <video controls preload="metadata" class="w-full h-full object-cover">
            <source src="${downloadUrl}" type="video/mp4">
          </video>
        </div>`;
    }

    // 2. Script Chip & Content
    let scriptChip = '<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-slate-800 text-slate-400">⏳ Chờ kịch bản</span>';
    if (v.scriptState === 'running') {
      scriptChip = '<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 pulse-dot">⚡ Đang xử lý...</span>';
    } else if (v.scriptState === 'done' || v.scriptBody) {
      scriptChip = '<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">✅ Văn bản tập xong</span>';
    }

    // 3. Voice & Subtitle Chip
    let voiceChip = '<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-slate-800 text-slate-400">⏳ Chờ</span>';
    if (v.voiceState === 'running') {
      voiceChip = '<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 pulse-dot">⚡ Đang tạo voice (1.35x)...</span>';
    } else if (v.voiceState === 'done') {
      voiceChip = '<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">✅ Voice & Sub (1.35x) xong</span>';
    }

    // 4. Final Video Chip & Inline Player
    let finalChip = '<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-slate-800 text-slate-400">⏳ Chờ</span>';
    if (v.finalVideoState === 'running') {
      finalChip = '<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 pulse-dot">⚡ Đang render...</span>';
    } else if (v.finalVideoState === 'done' || finalUrl || v.status === 'success') {
      finalChip = '<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">✅ Render thành công</span>';
    }

    let finalPlayerHtml = '<span class="text-[11px] text-slate-500 italic block mt-2">Đang xử lý / Chưa có video final</span>';
    if (finalUrl) {
      finalPlayerHtml = `
        <div class="relative bg-black rounded-xl overflow-hidden aspect-[9/16] w-36 max-h-56 mt-2 border border-slate-800 shadow-lg glow-purple">
          <video controls preload="metadata" class="w-full h-full object-cover">
            <source src="${finalUrl}" type="video/mp4">
          </video>
        </div>
        <a href="${finalUrl}" download class="inline-flex items-center justify-center gap-1 w-36 px-2.5 py-1.5 mt-2 bg-indigo-600/30 hover:bg-indigo-600/60 text-indigo-200 rounded-lg text-[11px] font-semibold border border-indigo-500/40 transition">
          📥 Tải Về Máy
        </a>`;
    }

    // 5. TikTok Upload Chip & Button
    let uploadChip = '<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">⏳ Sẵn sàng đăng</span>';
    if (v.uploadState === 'skipped') {
      uploadChip = '<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-slate-800 text-slate-400">⏭️ Tạm bỏ qua</span>';
    }

    return `
      <tr class="hover:bg-slate-900/50 transition align-top">
        <td class="p-3 text-center font-bold text-slate-400 font-mono">${i + 1}</td>

        <td class="p-3 space-y-1.5 min-w-[180px]">
          <div>${downloadChip}</div>
          <div class="font-bold text-indigo-300 font-mono text-xs">${v.id}</div>
          <div class="text-[11px] text-slate-400">@${escapeHtml(v.author)}</div>
          <div class="text-xs text-slate-200 line-clamp-2">${escapeHtml(v.desc)}</div>
          ${downloadPlayerHtml}
        </td>

        <td class="p-3 space-y-1.5 min-w-[240px] max-w-[320px]">
          <div>${scriptChip}</div>
          ${v.scriptTitle ? `<div class="font-bold text-indigo-300 text-xs mt-1">"${escapeHtml(v.scriptTitle)}"</div>` : ''}
          ${v.scriptBody ? `<div class="text-[11px] text-slate-300 leading-relaxed italic bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/60 max-h-36 overflow-y-auto mt-1 whitespace-pre-wrap">${escapeHtml(v.scriptBody)}</div>` : '<div class="text-xs text-slate-500 italic mt-1">(Chưa có văn bản)</div>'}
        </td>

        <td class="p-3 space-y-1.5">
          <div>${voiceChip}</div>
          <div class="text-[11px] text-slate-300 mt-1">Giọng: <b>Hoài My (1.35x)</b></div>
          <div class="text-[10px] text-slate-400">Tự động burn-in phụ đề Tiếng Việt</div>
        </td>

        <td class="p-3 space-y-1.5">
          <div>${finalChip}</div>
          <div>${finalPlayerHtml}</div>
        </td>

        <td class="p-3 text-center space-y-2">
          <div>${uploadChip}</div>
          <button onclick="triggerManualUpload('${v.id}')" class="w-full px-3 py-1.5 bg-gradient-to-r from-indigo-600 to-cyan-500 hover:opacity-90 text-white rounded-lg text-xs font-bold shadow-md transition flex items-center justify-center gap-1">
            🚀 Đăng TikTok
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function viewOutputVideo(videoId) {
  const tabVideos = document.querySelector('.nav-tab[data-tab="videos"]');
  if (tabVideos) tabVideos.click();
}

function triggerManualUpload(videoId) {
  Swal.fire({
    title: 'Đăng Video Lên TikTok',
    text: `Tính năng đăng tự động cho video ${videoId} tạm thời để nút mẫu. Bạn có muốn kích hoạt trong phiên bản tới?`,
    icon: 'info',
    showCancelButton: true,
    confirmButtonColor: '#6366f1',
    cancelButtonColor: '#374151',
    confirmButtonText: 'Đồng ý',
    cancelButtonText: 'Đóng',
    background: '#111827',
    color: '#fff',
  });
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatEta(seconds) {
  if (!seconds || seconds <= 0) return 'Hoàn Thành';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m} phút ${s}s`;
  return `${s} giây`;
}

// 2. Append Log to Terminal
function appendLog(log) {
  const div = document.createElement('div');
  div.className = 'leading-relaxed font-mono text-xs';

  let colorClass = 'text-slate-300';
  if (log.level === 'INFO') colorClass = 'text-cyan-400';
  if (log.level === 'SUCCESS') colorClass = 'text-emerald-400 font-semibold';
  if (log.level === 'WARN') colorClass = 'text-amber-400';
  if (log.level === 'ERROR') colorClass = 'text-rose-400 font-semibold';
  if (log.level === 'STEP') colorClass = 'text-purple-400 font-bold';

  div.innerHTML = `
    <span class="text-slate-500">[${log.time || new Date().toLocaleTimeString('vi-VN')}]</span>
    <span class="${colorClass}">[${log.level}]</span>
    <span class="text-slate-200 font-semibold">[${log.module}]</span>
    <span class="text-slate-300">${escapeHtml(log.message)}</span>
  `;
  terminalLogs.appendChild(div);

  if (autoScroll) {
    terminalLogs.scrollTop = terminalLogs.scrollHeight;
  }
}

function clearLogs() {
  terminalLogs.innerHTML = '<div class="text-slate-500 font-mono text-xs">[INFO] [Dashboard] Log đã xóa.</div>';
}

function escapeHtml(text) {
  return text ? text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : '';
}

// 3. Confirm & Run Pipeline with SweetAlert2
function confirmRunPipeline() {
  const currentTags = inputHashtags.value || 'satisfying,building,craft,lego';
  const storyMax = document.getElementById('input-max-episodes')?.value;
  const storyStart = document.getElementById('input-start-episode')?.value;
  const currentMax = storyMax || inputMaxVideos.value || 3;
  const currentStart = storyStart || 1;
  const currentMinViews = inputMinViews.value !== undefined ? inputMinViews.value : 10000;

  Swal.fire({
    title: '🚀 Kích Hoạt Pipeline Truyện Audio',
    html: `
      <div class="space-y-4 text-left font-sans pt-2">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-semibold text-slate-300 mb-1">Bắt Đầu Từ Tập:</label>
            <input id="swal-start-episode" type="number" min="1" max="100" class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs font-bold" value="${currentStart}">
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-300 mb-1">Số Tập Render Lần Này:</label>
            <input id="swal-max-videos" type="number" min="1" max="50" class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs font-bold text-amber-400" value="${currentMax}">
          </div>
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-300 mb-1">Hashtags Cào Video Nền (phân cách bằng dấu phẩy):</label>
          <input id="swal-hashtags" type="text" class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs" value="${escapeHtml(currentTags)}">
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-300 mb-1">Min View Lọc Video Nền (0 = Không Lọc):</label>
          <input id="swal-min-views" type="number" min="0" step="5000" class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs" value="${currentMinViews}">
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonColor: '#6366f1',
    cancelButtonColor: '#374151',
    confirmButtonText: '🚀 Bắt Đầu Render ngay!',
    cancelButtonText: 'Hủy',
    background: '#111827',
    color: '#fff',
    preConfirm: () => {
      return {
        hashtags: document.getElementById('swal-hashtags').value.trim(),
        maxVideos: parseInt(document.getElementById('swal-max-videos').value || '3'),
        startEpisode: parseInt(document.getElementById('swal-start-episode').value || '1'),
        minViews: parseInt(document.getElementById('swal-min-views').value || '0'),
      };
    }
  }).then((result) => {
    if (result.isConfirmed && result.value) {
      runPipeline(result.value);
    }
  });
}

async function runPipeline(options = {}) {
  try {
    btnRunPipeline.disabled = true;
    appendLog({ level: 'INFO', module: 'Dashboard', message: `Phát lệnh chạy Pipeline (${options.maxVideos || 5} video, minViews: ${options.minViews || 0})...` });

    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    const data = await res.json();

    if (data.success) {
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Pipeline đã kích hoạt!',
        showConfirmButton: false,
        timer: 3000,
        background: '#111827',
        color: '#fff',
      });
    } else {
      Swal.fire('Thất bại', data.message || 'Không thể chạy pipeline', 'error');
      btnRunPipeline.disabled = false;
    }
  } catch (err) {
    Swal.fire('Lỗi kết nối', err.message, 'error');
    btnRunPipeline.disabled = false;
  }
}

// 4. Tab Switcher
function initTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => {
        t.classList.remove('active', 'text-indigo-400', 'bg-indigo-500/10', 'border', 'border-indigo-500/20');
        t.classList.add('text-slate-400');
      });
      contents.forEach(c => c.classList.add('hidden'));

      tab.classList.add('active', 'text-indigo-400', 'bg-indigo-500/10', 'border', 'border-indigo-500/20');
      tab.classList.remove('text-slate-400');

      const targetId = `tab-${tab.dataset.tab}`;
      const targetContent = document.getElementById(targetId);
      if (targetContent) targetContent.classList.remove('hidden');

      if (tab.dataset.tab === 'videos') loadVideos();
    });
  });
}

// 5. Config Management
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    if (data.success && data.config) {
      populateConfig(data.config);
    }
  } catch (e) {
    console.error('Lỗi tải config:', e);
  }
}

function populateConfig(cfg) {
  inputApify.value = cfg.apifyToken || '';
  inputGemini.value = cfg.geminiKey || '';
  inputHashtags.value = cfg.hashtags || '';
  inputMaxVideos.value = cfg.maxVideos || 3;
  inputMinViews.value = cfg.minViews || 50000;
  if (cfg.voiceName) inputVoice.value = cfg.voiceName;
}

async function saveConfig(e) {
  e.preventDefault();
  saveStatus.textContent = 'Đang lưu...';

  const payload = {
    apifyToken: inputApify.value.trim(),
    geminiKey: inputGemini.value.trim(),
    hashtags: inputHashtags.value.trim(),
    maxVideos: inputMaxVideos.value,
    minViews: inputMinViews.value,
    voiceName: inputVoice.value,
  };

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (data.success) {
      saveStatus.textContent = '✅ Đã lưu!';
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Đã lưu cấu hình vào file .env!',
        showConfirmButton: false,
        timer: 2500,
        background: '#111827',
        color: '#fff',
      });
      setTimeout(() => { saveStatus.textContent = ''; }, 3000);
    } else {
      saveStatus.textContent = '❌ Lỗi: ' + data.error;
    }
  } catch (err) {
    saveStatus.textContent = '❌ Lỗi: ' + err.message;
  }
}

// 6. Video Gallery Loader
async function loadVideos() {
  try {
    const res = await fetch('/api/videos');
    const data = await res.json();

    if (!data.success || !data.videos || data.videos.length === 0) {
      videoGrid.innerHTML = `
        <div class="col-span-full text-center py-16 px-4 glass-card rounded-2xl border border-dashed border-slate-800">
          <i data-lucide="film" class="w-12 h-12 text-slate-600 mx-auto mb-3"></i>
          <p class="text-sm font-semibold text-slate-300">Chưa có video nào trong thư mục output</p>
          <p class="text-xs text-slate-500 mt-1">Bấm "CHẠY PIPELINE NGAY" để sinh video tự động đầu tiên!</p>
        </div>`;
      if (window.lucide) lucide.createIcons();
      videoCountBadge.textContent = '0';
      return;
    }

    videoCountBadge.textContent = data.videos.length;
    videoGrid.innerHTML = data.videos.map(v => `
      <div class="glass-card rounded-2xl overflow-hidden border border-slate-800 flex flex-col hover:border-slate-700 transition">
        <div class="relative bg-black aspect-[9/16] max-h-[380px] flex items-center justify-center">
          <video controls preload="metadata" class="w-full h-full object-cover">
            <source src="${v.url}" type="video/mp4">
            Browser không hỗ trợ video
          </video>
        </div>
        <div class="p-4 space-y-3 flex-1 flex flex-col justify-between">
          <div>
            <h4 class="text-sm font-semibold text-white truncate" title="${v.filename}">${v.filename}</h4>
            <div class="flex items-center justify-between text-xs text-slate-400 mt-1">
              <span>📦 ${v.sizeMB} MB</span>
              <span>🕒 ${v.createdAt}</span>
            </div>
          </div>
          <a href="${v.url}" download class="w-full py-2 px-3 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 font-semibold text-xs rounded-xl border border-indigo-500/30 transition flex items-center justify-center gap-2">
            <i data-lucide="download" class="w-4 h-4"></i>
            Tải Video Về Máy
          </a>
        </div>
      </div>
    `).join('');

    if (window.lucide) lucide.createIcons();

  } catch (err) {
    videoGrid.innerHTML = `<div class="col-span-full p-4 text-xs text-rose-400">Lỗi tải danh sách video: ${err.message}</div>`;
  }
}

// 7. ApexCharts Analytics Chart
function initAnalyticsChart() {
  const options = {
    chart: {
      type: 'area',
      height: 240,
      toolbar: { show: false },
      sparkline: { enabled: false },
      background: 'transparent',
    },
    theme: { mode: 'dark' },
    colors: ['#6366f1', '#10b981'],
    stroke: { curve: 'smooth', width: 2 },
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.45,
        opacityTo: 0.05,
        stops: [0, 90, 100]
      }
    },
    dataLabels: { enabled: false },
    grid: { borderColor: '#1f2937', strokeDashArray: 3 },
    series: [
      { name: 'Video Đã Đăng', data: [2, 4, 3, 5, 8, 6, 9] },
      { name: 'Thành Công (%)', data: [100, 100, 75, 100, 90, 100, 100] }
    ],
    xaxis: {
      categories: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'],
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { style: { colors: '#64748b', fontSize: '11px' } }
    },
    yaxis: {
      labels: { style: { colors: '#64748b', fontSize: '11px' } }
    },
    legend: {
      position: 'top',
      horizontalAlign: 'right',
      fontSize: '11px',
      labels: { colors: '#94a3b8' }
    }
  };

  const chartEl = document.getElementById('analytics-chart');
  if (chartEl && window.ApexCharts) {
    chart = new ApexCharts(chartEl, options);
    chart.render();
  }
}

// ==========================================
// STORY AUDIO TAB — Management Functions
// ==========================================
function initStoryTab() {
  const btnSaveStory = document.getElementById('btn-save-story');
  const btnLoadStory = document.getElementById('btn-load-story');
  const inputStoryContent = document.getElementById('input-story-content');
  const inputWordsPerEp = document.getElementById('input-words-per-ep');

  if (btnSaveStory) btnSaveStory.addEventListener('click', saveStory);
  if (btnLoadStory) btnLoadStory.addEventListener('click', loadStory);

  if (inputStoryContent) inputStoryContent.addEventListener('input', autoSplitStoryPreview);
  if (inputWordsPerEp) {
    inputWordsPerEp.addEventListener('input', () => {
      const maxEpInput = document.getElementById('input-max-episodes');
      if (maxEpInput) delete maxEpInput.dataset.userSet;
      autoSplitStoryPreview();
    });
  }

  // Auto-load story info on tab init
  loadStory();
}


// Load story info from server
async function loadStory() {
  try {
    const res = await fetch('/api/story');
    const data = await res.json();

    const titleDisplay = document.getElementById('story-title-display');
    const metaDisplay = document.getElementById('story-meta-display');
    const badge = document.getElementById('story-episode-badge');
    const totalBadge = document.getElementById('total-episodes-badge');

    if (data.success && data.totalEpisodes > 0) {
      if (titleDisplay) titleDisplay.textContent = data.storyTitle || 'Truyện Chưa Đặt Tên';
      if (metaDisplay) metaDisplay.textContent = `${data.totalEpisodes} tập | ${data.totalWords?.toLocaleString() || 0} từ${data.progress ? ` | Đã render đến Tập ${data.progress.lastProcessedEpisode}` : ''}`;
      if (badge) badge.textContent = `${data.totalEpisodes} tập`;
      if (totalBadge) totalBadge.textContent = `${data.totalEpisodes} tập`;

      // Auto-fill story title input
      const titleInput = document.getElementById('input-story-title');
      if (titleInput && !titleInput.value) titleInput.value = data.storyTitle || '';

      // Auto-set start episode to next unprocessed
      if (data.progress && data.progress.lastProcessedEpisode) {
        const startInput = document.getElementById('input-start-episode');
        if (startInput) startInput.value = data.progress.lastProcessedEpisode + 1;
      }

      renderEpisodesList(data.episodes || []);
    } else {
      if (titleDisplay) titleDisplay.textContent = 'Chưa có truyện nào';
      if (metaDisplay) metaDisplay.textContent = data.error || 'Dán nội dung truyện vào ô phía dưới để bắt đầu';
      if (badge) badge.textContent = '0 tập';
      if (totalBadge) totalBadge.textContent = '0 tập';
    }
  } catch (e) {
    console.warn('Không tải được thông tin truyện:', e.message);
  }
}

// Save story from textarea
async function saveStory() {
  const titleInput = document.getElementById('input-story-title');
  const contentInput = document.getElementById('input-story-content');
  const statusEl = document.getElementById('story-save-status');
  const btn = document.getElementById('btn-save-story');

  const storyContent = contentInput?.value?.trim();
  const storyTitle = titleInput?.value?.trim() || 'Truyện Của Tôi';

  if (!storyContent || storyContent.length < 50) {
    if (statusEl) { statusEl.textContent = '❌ Nội dung truyện quá ngắn!'; statusEl.className = 'text-xs font-medium text-rose-400 min-h-[18px]'; }
    return;
  }

  if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Đang phân đoạn...'; if (window.lucide) lucide.createIcons(); }
  if (statusEl) { statusEl.textContent = 'Đang lưu và phân đoạn truyện...'; statusEl.className = 'text-xs font-medium text-slate-400 min-h-[18px]'; }

  try {
    const res = await fetch('/api/story', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyContent, storyTitle }),
    });
    const data = await res.json();

    if (data.success) {
      if (statusEl) { statusEl.textContent = `✅ ${data.message}`; statusEl.className = 'text-xs font-medium text-emerald-400 min-h-[18px]'; }
      setTimeout(() => loadStory(), 500);
    } else {
      if (statusEl) { statusEl.textContent = `❌ ${data.error}`; statusEl.className = 'text-xs font-medium text-rose-400 min-h-[18px]'; }
    }
  } catch (e) {
    if (statusEl) { statusEl.textContent = `❌ Lỗi kết nối: ${e.message}`; statusEl.className = 'text-xs font-medium text-rose-400 min-h-[18px]'; }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="save" class="w-4 h-4"></i> Lưu &amp; Phân Đoạn'; if (window.lucide) lucide.createIcons(); }
  }
}

// Run story pipeline from Story tab
async function runStoryPipeline() {
  const startEpisode = parseInt(document.getElementById('input-start-episode')?.value) || 1;
  const maxEpisodes = parseInt(document.getElementById('input-max-episodes')?.value) || 3;
  const wordsPerEp = parseInt(document.getElementById('input-words-per-ep')?.value) || 200;
  const musicVol = parseFloat(document.getElementById('input-music-vol')?.value) || 0.40;
  const storyTitle = document.getElementById('input-story-title')?.value?.trim();
  const storyContent = document.getElementById('input-story-content')?.value?.trim();

  const confirmResult = await Swal.fire({
    title: '🎧 Render Truyện Audio',
    html: `<div class="text-left text-sm space-y-2">
      <p>📖 Truyện: <b>${storyTitle || 'Truyện hiện tại'}</b></p>
      <p>🎬 Render: Tập <b>${startEpisode}</b> đến <b>${startEpisode + maxEpisodes - 1}</b> (${maxEpisodes} tập)</p>
      <p>🎵 Nhạc Lofi: <b>${(musicVol * 100).toFixed(0)}%</b> âm lượng</p>
    </div>`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Chạy Ngay!',
    cancelButtonText: 'Hủy',
    background: '#111827',
    color: '#f1f5f9',
    confirmButtonColor: '#6366f1',
  });

  if (!confirmResult.isConfirmed) return;

  const btn = document.getElementById('btn-run-story');
  const statusEl = document.getElementById('story-save-status');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Đang kích hoạt...'; if (window.lucide) lucide.createIcons(); }

  try {
    const body = {
      maxVideos: maxEpisodes,
      startEpisode,
      wordsPerEpisode: wordsPerEp,
    };
    if (storyContent && storyContent.length > 50) {
      body.storyContent = storyContent;
      body.storyTitle = storyTitle;
    }

    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (data.success) {
      if (statusEl) { statusEl.textContent = '✅ Pipeline đã kích hoạt! Theo dõi tiến trình ở tab Tiến Trình Realtime'; statusEl.className = 'text-xs font-medium text-emerald-400 min-h-[18px]'; }
      // Switch to progress tab
      setTimeout(() => {
        const progressTab = document.querySelector('[data-tab="progress"]');
        if (progressTab) progressTab.click();
      }, 1000);
    } else {
      if (statusEl) { statusEl.textContent = `❌ ${data.message}`; statusEl.className = 'text-xs font-medium text-rose-400 min-h-[18px]'; }
    }
  } catch (e) {
    if (statusEl) { statusEl.textContent = `❌ Lỗi: ${e.message}`; statusEl.className = 'text-xs font-medium text-rose-400 min-h-[18px]'; }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="play" class="w-4 h-4 fill-white"></i> Render Truyện Ngay'; if (window.lucide) lucide.createIcons(); }
  }
}

// Render episodes list in Story tab
function renderEpisodesList(episodes) {
  const container = document.getElementById('episodes-list');
  if (!container) return;

  if (!episodes || episodes.length === 0) {
    container.innerHTML = '<div class="text-center text-slate-500 text-sm py-12">Chưa có tập nào</div>';
    return;
  }

  container.innerHTML = episodes.map(ep => {
    const mins = Math.floor(ep.estimatedDurationSeconds / 60);
    const secs = ep.estimatedDurationSeconds % 60;
    const dur = mins > 0 ? `${mins}p${secs}s` : `${secs}s`;
    return `
      <div class="flex items-start gap-3 p-3 rounded-xl bg-slate-900/60 border border-slate-800/60 hover:border-amber-500/30 transition group">
        <div class="w-8 h-8 flex-shrink-0 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center text-amber-400 font-bold text-xs mt-0.5">${ep.index}</div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-xs font-semibold text-white truncate">${ep.title}</span>
            <span class="flex-shrink-0 px-1.5 py-0.5 text-[10px] bg-slate-800 text-slate-400 rounded font-mono">${ep.wordCount}t~${dur}</span>
          </div>
          <p class="text-[11px] text-slate-500 leading-relaxed line-clamp-2">${ep.preview || ''}</p>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

// Auto-split preview client side on typing or changing words-per-ep
function autoSplitStoryPreview() {
  const contentInput = document.getElementById('input-story-content');
  const wordsInput = document.getElementById('input-words-per-ep');
  const totalBadge = document.getElementById('total-episodes-badge');
  const maxEpInput = document.getElementById('input-max-episodes');

  const content = contentInput?.value?.trim() || '';
  const targetWords = parseInt(wordsInput?.value) || 200;

  if (!content || content.length < 30) return;

  const words = content.split(/\s+/).filter(Boolean);
  if (words.length === 0) return;

  // Split by targetWords (~200 words per episode)
  const episodes = [];
  let currentWords = [];

  for (let i = 0; i < words.length; i++) {
    currentWords.push(words[i]);
    if (currentWords.length >= targetWords || i === words.length - 1) {
      const epText = currentWords.join(' ');
      const estSec = Math.round(currentWords.length / 2.8);
      episodes.push({
        index: episodes.length + 1,
        title: `Tập ${episodes.length + 1}`,
        wordCount: currentWords.length,
        estimatedDurationSeconds: estSec,
        preview: epText.substring(0, 140) + '...',
        content: epText,
      });
      currentWords = [];
    }
  }

  if (totalBadge) totalBadge.textContent = `${episodes.length} tập`;
  if (maxEpInput && !maxEpInput.dataset.userSet) {
    maxEpInput.value = episodes.length;
  }
  renderEpisodesList(episodes);
}
