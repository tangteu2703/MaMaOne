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

  // Event Listeners
  btnRunPipeline.addEventListener('click', confirmRunPipeline);
  btnClearLogs.addEventListener('click', clearLogs);
  chkAutoScroll.addEventListener('change', (e) => { autoScroll = e.target.checked; });
  formConfig.addEventListener('submit', saveConfig);
  btnRefreshVideos.addEventListener('click', loadVideos);
});

// 1. WebSocket Setup
function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}`;

  ws = new WebSocket(wsUrl);

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
      updateRealtimeProgress(msg.data);
      break;

    case 'config_updated':
      populateConfig(msg.data);
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

  // 3. Update Scraped Queue Table
  if (data.videoId && !scrapedVideosQueue.some(v => v.id === data.videoId)) {
    scrapedVideosQueue.push({
      id: data.videoId,
      author: data.videoAuthor || 'unknown',
      desc: data.videoDesc || 'N/A',
      views: '1,200,000+',
      status: data.step === 5 && data.stepPercent === 100 ? '✅ Hoàn Thành' : '🔄 Đang Xử Lý'
    });
    renderScrapedQueue();
  } else if (data.videoId) {
    const item = scrapedVideosQueue.find(v => v.id === data.videoId);
    if (item) {
      item.status = (data.step === 5 && data.stepPercent === 100) ? '✅ Hoàn Thành' : `🔄 Bước ${data.step}/5 (${data.stepName})`;
      renderScrapedQueue();
    }
  }

  // 4. Update Script Preview List
  if (data.scriptTitle) {
    if (!translatedScriptsList.some(s => s.id === data.videoId)) {
      translatedScriptsList.push({
        id: data.videoId,
        title: data.scriptTitle,
        details: data.details,
      });
    }
    renderScriptList();
  }
}

function renderScrapedQueue() {
  if (scrapedVideosQueue.length === 0) return;
  scrapedQueueTbody.innerHTML = scrapedVideosQueue.map((v, i) => `
    <tr class="hover:bg-slate-900/50 transition">
      <td class="p-3 font-bold text-slate-400">${i + 1}</td>
      <td class="p-3">
        <div class="font-bold text-indigo-300">${v.id}</div>
        <div class="text-[11px] text-slate-400">@${v.author}</div>
      </td>
      <td class="p-3 max-w-xs truncate text-slate-200">${escapeHtml(v.desc)}</td>
      <td class="p-3 text-right font-bold text-cyan-400">${v.views}</td>
      <td class="p-3 text-center">
        <span class="px-2.5 py-1 text-[10px] font-bold rounded-full ${v.status.includes('✅') ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'}">
          ${v.status}
        </span>
      </td>
    </tr>
  `).join('');
}

function renderScriptList() {
  if (translatedScriptsList.length === 0) return;
  scriptPreviewContainer.innerHTML = translatedScriptsList.map((s, i) => `
    <div class="bg-slate-950/80 p-4 rounded-xl border border-slate-800/80 space-y-2">
      <div class="flex justify-between items-center">
        <h4 class="text-sm font-bold text-indigo-300">#${i + 1} - Tiêu đề: "${escapeHtml(s.title)}"</h4>
        <span class="px-2 py-0.5 text-[10px] font-bold bg-purple-500/20 text-purple-300 rounded-full border border-purple-500/30">ID: ${s.id}</span>
      </div>
      <p class="text-xs text-slate-300 leading-relaxed font-sans">${escapeHtml(s.details || 'Đã dịch kịch bản Tiếng Việt hoàn chỉnh với AI Gemini.')}</p>
    </div>
  `).join('');
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
  Swal.fire({
    title: 'Kích Hoạt Pipeline?',
    text: 'Hệ thống sẽ cào trend TikTok → Dịch AI → Tạo voice → Ghép video!',
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#6366f1',
    cancelButtonColor: '#374151',
    confirmButtonText: '🚀 Chạy Ngay!',
    cancelButtonText: 'Hủy',
    background: '#111827',
    color: '#fff',
  }).then((result) => {
    if (result.isConfirmed) {
      runPipeline();
    }
  });
}

async function runPipeline() {
  try {
    btnRunPipeline.disabled = true;
    appendLog({ level: 'INFO', module: 'Dashboard', message: 'Đã phát lệnh chạy Pipeline từ Dashboard!' });

    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
