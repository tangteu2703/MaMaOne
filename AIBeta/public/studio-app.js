/* ==========================================
   AIBeta Studio — studio-app.js
   Frontend Logic: Stories, Audio Render, Video
   ========================================== */

'use strict';

// ---- State ----
const State = {
  stories: [],
  selectedStoryId: null,
  selectedStoryData: null,
  audioFiles: [],
  videoBgFiles: [],
  musicFiles: [],
  outputVideos: [],
  mappingRows: [],    // { id, audioFile, videoBgFile, musicFile }
  currentAudioJob: null,
  currentVideoJob: null,
  ws: null,
};

// ---- Utils ----
function formatDuration(secs) {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
function formatWords(n) { return n ? `${n.toLocaleString()} từ` : ''; }
function fmtSize(kb) { return kb > 1024 ? `${(kb/1024).toFixed(1)} MB` : `${kb} KB`; }

function showToast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]||'ℹ️'}</span><span>${msg}</span>`;
  c.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; el.style.transition = 'all 0.3s'; setTimeout(() => el.remove(), 300); }, 3500);
}

async function api(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  return res.json();
}

// ---- WebSocket ----
function connectWS() {
  const wsUrl = `ws://${location.host}`;
  try {
    State.ws = new WebSocket(wsUrl);
    State.ws.onopen = () => {
      const dot = document.querySelector('.ws-dot');
      const lbl = document.getElementById('ws-label');
      if (dot) { dot.classList.add('connected'); dot.classList.remove('error'); }
      if (lbl) lbl.textContent = 'Đã kết nối';
    };
    State.ws.onclose = () => {
      const dot = document.querySelector('.ws-dot');
      if (dot) { dot.classList.remove('connected'); }
      setTimeout(connectWS, 3000);
    };
    State.ws.onerror = () => {
      const dot = document.querySelector('.ws-dot');
      if (dot) dot.classList.add('error');
    };
    State.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        handleWsMessage(msg);
      } catch {}
    };
  } catch {}
}

function handleWsMessage(msg) {
  switch (msg.type) {
    case 'audio_render_progress':
      onAudioRenderProgress(msg.data);
      break;
    case 'audio_render_complete':
      onAudioRenderComplete(msg.data);
      break;
    case 'video_render_progress':
      onVideoRenderProgress(msg.data);
      break;
    case 'video_render_complete':
      onVideoRenderComplete(msg.data);
      break;
  }
}

// ---- Tab navigation ----
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(tabId).classList.add('active');
      if (tabId === 'tab-audio') refreshAudioStoryList();
      if (tabId === 'tab-video') { refreshAudioSourceList(); refreshMediaFiles(); refreshOutputVideos(); }
    });
  });
}

// ==========================================
// TAB 1: STORIES
// ==========================================

async function loadStories() {
  try {
    const res = await api('GET', '/api/stories');
    if (res.success) {
      State.stories = res.stories || [];
      renderStoryList();
      refreshAudioStoryList();
      // Tự động chọn truyện đầu tiên khi tải trang
      if (State.stories.length && !State.selectedStoryId) {
        await selectStory(State.stories[0].id);
      }
    }
  } catch {}
}

function renderStoryList() {
  const list = document.getElementById('story-list');
  const emptyState = document.getElementById('story-empty-state');
  if (!State.stories.length) {
    list.innerHTML = '';
    if (emptyState) { emptyState.style.display = 'flex'; list.appendChild(emptyState); }
    return;
  }
  list.innerHTML = State.stories.map(s => `
    <div class="story-card ${s.id === State.selectedStoryId ? 'selected' : ''}" data-id="${s.id}" onclick="selectStory('${s.id}')">
      <div class="story-card-title">${s.title}</div>
      <div class="story-card-meta">
        <i class="bi bi-file-text" style="font-size:.6rem;opacity:.5"></i>
        <span>${formatWords(s.wordCount)}</span>
        ${s.episodesRendered ? `<span class="story-card-badge">✓ ${s.episodesRendered} tập</span>` : ''}
      </div>
      <div class="story-card-actions">
        <button class="btn-story-action" onclick="event.stopPropagation(); editStory('${s.id}')">
          <i class="bi bi-pencil-fill" style="font-size:.6rem"></i> Sửa
        </button>
        <button class="btn-story-action danger" onclick="event.stopPropagation(); deleteStory('${s.id}', '${s.title}')">
          <i class="bi bi-trash3-fill" style="font-size:.6rem"></i> Xoá
        </button>
      </div>
    </div>
  `).join('');
}

async function selectStory(id) {
  State.selectedStoryId = id;
  renderStoryList();
  const story = State.stories.find(s => s.id === id);
  if (!story) return;

  // Load full detail to editor
  document.getElementById('editor-title').textContent = `Chỉnh sửa: ${story.title}`;
  document.getElementById('input-story-title').value = story.title;

  const res = await api('GET', `/api/stories/${id}?wordsPerEpisode=300`);
  if (res.success) {
    State.selectedStoryData = res;
    document.getElementById('input-story-content').value = res.content || '';
    updateWordCount();
    showEpisodePreview(res.episodes);
  }
  document.getElementById('btn-discard').style.display = 'inline-flex';
}

function editStory(id) {
  selectStory(id);
}

async function deleteStory(id, title) {
  if (!confirm(`Xoá truyện "${title}"?`)) return;
  const res = await api('DELETE', `/api/stories/${id}`);
  if (res.success) {
    showToast(`Đã xoá "${title}"`, 'success');
    await loadStories();
  } else {
    showToast('Xoá thất bại: ' + res.error, 'error');
  }
}

function newStory() {
  State.selectedStoryId = null;
  State.selectedStoryData = null;
  renderStoryList();
  document.getElementById('editor-title').textContent = 'Truyện mới';
  document.getElementById('input-story-title').value = '';
  document.getElementById('input-story-desc').value = '';
  document.getElementById('input-story-url').value = '';
  document.getElementById('input-story-content').value = '';
  document.getElementById('episode-preview').style.display = 'none';
  document.getElementById('story-save-status').textContent = '';
  document.getElementById('btn-discard').style.display = 'none';
  document.getElementById('content-word-count').textContent = '';
}

function updateWordCount() {
  const content = document.getElementById('input-story-content').value;
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  const el = document.getElementById('content-word-count');
  if (el) el.textContent = words > 0 ? `${words.toLocaleString()} từ` : '';
  if (content.length > 100) {
    document.getElementById('episode-preview').style.display = 'block';
  }
}

function showEpisodePreview(episodes) {
  if (!episodes || !episodes.length) return;
  document.getElementById('episode-preview').style.display = 'block';
  const list = document.getElementById('episode-preview-list');
  list.innerHTML = episodes.map(ep => `
    <div class="ep-preview-item">
      <span class="ep-preview-num">Tập ${ep.index}</span>
      <span class="ep-preview-words">${ep.wordCount} từ</span>
      <span class="ep-preview-dur">~${formatDuration(ep.estimatedDurationSeconds)}</span>
      <span class="ep-preview-text">${ep.preview || ''}</span>
    </div>
  `).join('');
}

async function previewEpisodes() {
  const content = document.getElementById('input-story-content').value;
  const wordsPerEp = parseInt(document.getElementById('words-per-ep').value) || 300;
  if (!content.trim()) return;
  // Call API with temp save or just show estimate client-side
  const lines = content.split(/\n\n+/);
  let eps = [], current = [], currentWords = 0;
  for (const para of lines) {
    const wc = para.trim().split(/\s+/).length;
    if (currentWords + wc > wordsPerEp * 1.3 && currentWords >= wordsPerEp * 0.7) {
      eps.push({ index: eps.length + 1, wordCount: currentWords, preview: current[0]?.substring(0, 80) + '...', estimatedDurationSeconds: Math.round(currentWords / 2.8) });
      current = []; currentWords = 0;
    }
    current.push(para.trim());
    currentWords += wc;
  }
  if (current.length) eps.push({ index: eps.length + 1, wordCount: currentWords, preview: current[0]?.substring(0, 80) + '...', estimatedDurationSeconds: Math.round(currentWords / 2.8) });
  showEpisodePreview(eps);
}

async function saveStory() {
  const title = document.getElementById('input-story-title').value.trim();
  const content = document.getElementById('input-story-content').value.trim();
  const genre = document.getElementById('input-story-genre').value;
  const description = document.getElementById('input-story-desc').value.trim();
  const wordsPerEpisode = parseInt(document.getElementById('words-per-ep')?.value) || 0;

  if (!title) { showToast('Vui lòng nhập tiêu đề truyện!', 'warning'); return; }
  if (content.length < 50) { showToast('Nội dung truyện quá ngắn!', 'warning'); return; }

  const btn = document.getElementById('btn-save-story');
  btn.textContent = 'Đang lưu...';
  btn.disabled = true;

  try {
    const res = await api('POST', '/api/stories', { title, content, genre, description, wordsPerEpisode });
    if (res.success) {
      State.currentStoryId = res.id;
      showToast(`Đã lưu "${title}" (${res.wordCount?.toLocaleString()} từ, ${res.episodeCount || 1} đoạn SRT)`, 'success');
      document.getElementById('story-save-status').textContent = '✅ Đã lưu thành công!';
      // Hiện button tải SRT
      const srtBtn = document.getElementById('btn-download-srt');
      if (srtBtn) { srtBtn.style.display = ''; srtBtn.dataset.storyId = res.id; }
      await loadStories();
      previewEpisodes();
    } else {
      showToast('Lỗi: ' + res.error, 'error');
    }
  } catch (e) {
    showToast('Lỗi kết nối máy chủ', 'error');
  } finally {
    btn.textContent = 'Lưu truyện';
    btn.disabled = false;
  }
}

function downloadStorySRT() {
  const btn = document.getElementById('btn-download-srt');
  const storyId = btn?.dataset?.storyId || State.currentStoryId;
  if (!storyId) { showToast('Hãy lưu truyện trước!', 'warning'); return; }
  window.open(`/api/stories/${storyId}/srt`, '_blank');
}

async function crawlUrl() {
  const url = document.getElementById('input-story-url').value.trim();
  if (!url) { showToast('Vui lòng nhập URL!', 'warning'); return; }
  const btn = document.getElementById('btn-crawl-url');
  btn.textContent = 'Đang crawl...'; btn.disabled = true;
  try {
    // Simple fetch + extract text via server-side
    const res = await api('POST', '/api/crawl-url', { url });
    if (res.success && res.content) {
      document.getElementById('input-story-content').value = res.content;
      if (res.title && !document.getElementById('input-story-title').value) {
        document.getElementById('input-story-title').value = res.title;
      }
      updateWordCount();
      showToast('Crawl nội dung thành công!', 'success');
    } else {
      showToast('Không thể crawl URL này: ' + (res.error || 'Hãy copy thủ công'), 'warning');
    }
  } catch { showToast('Lỗi kết nối', 'error'); }
  finally { btn.textContent = 'Crawl'; btn.disabled = false; }
}

// ==========================================
// TAB 2: RENDER AUDIO
// ==========================================

function refreshAudioStoryList() {
  const list = document.getElementById('audio-story-list');
  if (!State.stories.length) {
    list.innerHTML = '<div class="text-center text-secondary py-4" style="font-size:.8rem"><i class="bi bi-book fs-3 d-block mb-2 opacity-25"></i>Chưa có truyện<br><small>Tạo truyện ở Tab 1</small></div>';
    return;
  }
  list.innerHTML = State.stories.map(s => `
    <div class="audio-story-item ${s.id === State.selectedStoryId ? 'selected' : ''}" onclick="selectAudioStory('${s.id}')">
      <div class="audio-story-item-title">${s.title}</div>
      <div class="audio-story-item-meta">
        ${formatWords(s.wordCount)}
        ${s.episodesRendered ? `<span class="story-card-badge" style="background:rgba(245,158,11,.15);color:#f59e0b">✓ ${s.episodesRendered} tập</span>` : ''}
        <span class="story-card-badge" style="background:rgba(6,182,212,.12);color:#67e8f9">SRT</span>
      </div>
    </div>
  `).join('');
}

async function selectAudioStory(id) {
  State.selectedStoryId = id;
  document.querySelectorAll('.audio-story-item').forEach(el => el.classList.toggle('selected', el.onclick?.toString().includes(`'${id}'`)));

  const wordsPerEp = parseInt(document.getElementById('audio-words-per-ep')?.value) || 0;
  const res = await api('GET', `/api/stories/${id}?wordsPerEpisode=${wordsPerEp}`);
  if (!res.success) { showToast('Không thể tải truyện!', 'error'); return; }
  State.selectedStoryData = res;

  document.getElementById('audio-placeholder').style.display = 'none';
  document.getElementById('audio-setup-content').style.display = 'flex';
  document.getElementById('audio-story-name').textContent = res.title;
  document.getElementById('audio-story-meta').textContent = `${formatWords(res.wordCount)} · ${res.episodes.length} tập`;

  buildEpisodesChecklist(res.episodes);
  buildEpisodePreviewSelect(res.episodes);
}

function buildEpisodesChecklist(episodes) {
  const container = document.getElementById('episodes-checklist');
  container.innerHTML = episodes.map(ep => {
    const hasTs = ep.startSeconds != null;
    const tsStr = hasTs
      ? `<span class="font-mono" style="font-size:.65rem;color:#67e8f9">${formatDuration(ep.startSeconds)}→${formatDuration(ep.endSeconds ?? ep.startSeconds + ep.estimatedDurationSeconds)}</span>`
      : `<span class="font-mono text-secondary" style="font-size:.65rem">~${formatDuration(ep.estimatedDurationSeconds)}</span>`;
    return `
    <label class="ep-check-item checked d-flex align-items-center gap-2 p-2" id="epchk-${ep.index}">
      <input type="checkbox" value="${ep.index}" checked onchange="toggleEpCheck(this)">
      <span style="font-size:.78rem">Tập ${ep.index}</span>
      <span class="ms-auto d-flex align-items-center gap-2">
        <span class="text-secondary" style="font-size:.65rem">${ep.wordCount}t</span>
        ${tsStr}
      </span>
    </label>`;
  }).join('');
}

function buildEpisodePreviewSelect(episodes) {
  const sel = document.getElementById('preview-ep-select');
  sel.innerHTML = '<option value="">— Chọn tập để xem trước —</option>' +
    episodes.map(ep => `<option value="${ep.index}">Tập ${ep.index} (${ep.wordCount} từ)</option>`).join('');
  // Tự động chọn tập đầu tiên và hiển thị nội dung
  if (episodes.length) {
    sel.value = episodes[0].index;
    sel.dispatchEvent(new Event('change'));
  }
}

function toggleEpCheck(input) {
  const label = input.closest('.ep-check-item');
  label.classList.toggle('checked', input.checked);
}

function selectAllEpisodes(checked) {
  document.querySelectorAll('#episodes-checklist input[type=checkbox]').forEach(cb => {
    cb.checked = checked;
    cb.closest('.ep-check-item').classList.toggle('checked', checked);
  });
}

function getSelectedEpisodes() {
  return Array.from(document.querySelectorAll('#episodes-checklist input[type=checkbox]:checked')).map(cb => parseInt(cb.value));
}

async function reloadEpisodes() {
  if (!State.selectedStoryId) return;
  await selectAudioStory(State.selectedStoryId);
}

async function startAudioRender() {
  if (!State.selectedStoryId) { showToast('Vui lòng chọn truyện trước!', 'warning'); return; }
  const selectedEps = getSelectedEpisodes();
  if (!selectedEps.length) { showToast('Chọn ít nhất 1 tập!', 'warning'); return; }

  const voiceName = document.getElementById('audio-voice').value;
  const rate = parseInt(document.getElementById('audio-rate').value);
  const volume = parseInt(document.getElementById('audio-volume').value);
  const wordsPerEp = parseInt(document.getElementById('audio-words-per-ep').value) || 0;

  const payload = {
    storyId: State.selectedStoryId,
    episodes: selectedEps,
    voiceName, rate, volume, wordsPerEpisode: wordsPerEp,
  };

  console.group('🎙️ [Render Audio] Request');
  console.log('Payload:', JSON.stringify(payload, null, 2));
  console.groupEnd();

  const btn = document.getElementById('btn-start-audio-render');
  btn.disabled = true; btn.innerHTML = '<i class="bi bi-arrow-repeat spin me-1"></i> Đang render...';

  try {
    const res = await api('POST', '/api/render-audio', payload);

    console.group('🎙️ [Render Audio] Response');
    console.log('Response:', JSON.stringify(res, null, 2));
    console.groupEnd();

    if (res.success) {
      State.currentAudioJob = { jobId: res.jobId, total: res.total, done: 0 };
      showToast(`Bắt đầu render ${res.total} tập audio!`, 'info');
      showAudioRenderBar(res.total);
    } else {
      showToast('Lỗi: ' + res.error, 'error');
      resetRenderBtn();
    }
  } catch (err) {
    console.error('🎙️ [Render Audio] ERROR:', err);
    showToast('Lỗi kết nối máy chủ', 'error');
    resetRenderBtn();
  }
}


function resetRenderBtn() {
  const btn = document.getElementById('btn-start-audio-render');
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-play-fill me-1"></i> Bắt đầu Render'; }
}

function showAudioRenderBar(total) {
  const bar = document.getElementById('audio-render-bar');
  bar.style.display = 'block';
  document.getElementById('rpb-count').textContent = `0/${total}`;
  document.getElementById('rpb-fill').style.width = '0%';
  document.getElementById('rpb-label').textContent = 'Đang render audio...';
}

function onAudioRenderProgress(data) {
  const bar = document.getElementById('audio-render-bar');
  if (!bar) return;
  bar.style.display = 'block';
  const total = data.total || 1;
  const done = data.done || 0;
  document.getElementById('rpb-count').textContent = `${done}/${total}`;
  document.getElementById('rpb-fill').style.width = `${Math.round(done/total*100)}%`;
  document.getElementById('rpb-label').textContent = `Đang render Tập ${data.episodeIndex}...`;

  // Add result card immediately
  if (data.filename) {
    addAudioResultItem(data);
  }
  // Update badge
  refreshAudioBadge();
}

function onAudioRenderComplete(data) {
  showToast('Hoàn thành render audio!', 'success');
  resetRenderBtn();
  refreshAudioFiles();
  document.getElementById('audio-render-bar').style.display = 'none';
}

function addAudioResultItem(data) {
  const list = document.getElementById('audio-results-list');
  // Remove empty state
  const empty = list.querySelector('[style*="grid-column"]');
  if (empty) empty.remove();

  const cardId = `acard-${data.episodeIndex}`;
  const existing = document.getElementById(cardId);
  const statusIcon = data.status === 'done' ? '🎵' : data.status === 'error' ? '❌' : '⏳';
  const statusClass = data.status || 'rendering';

  if (existing) {
    existing.className = `audio-card ${statusClass}`;
    existing.querySelector('.audio-card-icon').textContent = statusIcon;
    return;
  }

  const card = document.createElement('div');
  card.id = cardId;
  card.className = `audio-card ${statusClass}`;
  const shortName = (data.filename || `Tập ${data.episodeIndex}`).replace(/\.mp3$/i,'');
  card.innerHTML = `
    <div class="audio-card-icon">${statusIcon}</div>
    <div class="audio-card-name" title="${data.filename || ''}">Tập ${data.episodeIndex}</div>
    <div class="audio-card-meta">
      ${data.wordCount ? formatWords(data.wordCount) : ''}
      ${data.fileSizeKB ? fmtSize(data.fileSizeKB) : ''}
    </div>
    <div class="audio-card-actions">
      ${data.status === 'done' && data.url ? `
        <button class="btn-aca play" onclick="toggleAudioCardPlay(this,'${data.url}','${data.filename}')" title="Phát"><i class="bi bi-play-fill"></i></button>
        <button class="btn-aca rerender" onclick="reRenderByFilename('${data.filename}')" title="Render lại"><i class="bi bi-arrow-repeat"></i></button>
        <button class="btn-aca del" onclick="deleteAudioFile('${data.filename}')" title="Xóa"><i class="bi bi-trash"></i></button>
      ` : `<span style="font-size:.6rem;color:#f59e0b">⏳ Đang render...</span>`}
    </div>
  `;
  list.insertBefore(card, list.firstChild);
}

let currentAudioEl = null;
function toggleAudioPlay(btn, url, name) {
  const item = btn.closest('.audio-result-item');
  const existingPlayer = item.querySelector('.inline-audio-player');
  if (existingPlayer) { existingPlayer.remove(); btn.innerHTML = '<i class="bi bi-play-fill"></i> Phát'; return; }
  if (currentAudioEl) { currentAudioEl.remove(); }
  const player = document.createElement('div');
  player.className = 'inline-audio-player';
  player.innerHTML = `<audio controls autoplay src="${url}" style="width:100%;height:32px;margin-top:6px;"></audio>`;
  item.appendChild(player);
  currentAudioEl = player;
  btn.innerHTML = '⏹ Dừng';
}

async function refreshAudioFiles() {
  try {
    const res = await api('GET', '/api/audio-files');
    if (res.success) {
      State.audioFiles = res.files || [];
      renderAudioResultsList();
      refreshAudioBadge();
    }
  } catch {}
}

function renderAudioResultsList() {
  const list = document.getElementById('audio-results-list');
  const badge = document.getElementById('audio-count-badge');
  if (badge) badge.textContent = State.audioFiles.length;
  if (!State.audioFiles.length) {
    list.innerHTML = '<div style="grid-column:1/-1" class="text-center text-secondary py-4"><i class="bi bi-music-note fs-2 d-block mb-2 opacity-25"></i><div style="font-size:.8rem">Chưa có file audio</div><small>Bắt đầu render ở trên</small></div>';
    return;
  }
  list.innerHTML = State.audioFiles.map(f => `
    <div class="audio-card done" id="acard-${f.filename.replace(/[^a-zA-Z0-9]/g,'_')}">
      <div class="audio-card-icon">🎵</div>
      <div class="audio-card-name" title="${f.filename}">${f.filename.replace(/\.mp3$/i,'')}</div>
      <div class="audio-card-meta">${fmtSize(f.fileSizeKB)}</div>
      <div class="audio-card-actions">
        <button class="btn-aca play" onclick="toggleAudioCardPlay(this,'${f.url}','${f.filename}')" title="Phát">
          <i class="bi bi-play-fill"></i>
        </button>
        <button class="btn-aca rerender" onclick="reRenderByFilename('${f.filename}')" title="Render lại">
          <i class="bi bi-arrow-repeat"></i>
        </button>
        <button class="btn-aca del" onclick="deleteAudioFile('${f.filename}')" title="Xóa">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    </div>
  `).join('');
}

function refreshAudioBadge() {
  const badge = document.getElementById('badge-audio');
  if (badge) badge.textContent = State.audioFiles.length;
  const countBadge = document.getElementById('audio-count-badge');
  if (countBadge) countBadge.textContent = State.audioFiles.length;
}

// Play audio inside a small card (toggle)
let currentCardAudioEl = null;
function toggleAudioCardPlay(btn, url, name) {
  const card = btn.closest('.audio-card');
  const existingPlayer = card.querySelector('.inline-audio-player');
  if (existingPlayer) {
    existingPlayer.remove();
    btn.innerHTML = '<i class="bi bi-play-fill"></i>';
    currentCardAudioEl = null;
    return;
  }
  if (currentCardAudioEl) { currentCardAudioEl.remove(); currentCardAudioEl = null; }
  // Reset all play buttons
  document.querySelectorAll('.btn-aca.play').forEach(b => b.innerHTML = '<i class="bi bi-play-fill"></i>');
  const player = document.createElement('div');
  player.className = 'inline-audio-player';
  player.innerHTML = `<audio controls autoplay src="${url}" style="width:100%;height:26px;"></audio>`;
  card.appendChild(player);
  currentCardAudioEl = player;
  btn.innerHTML = '<i class="bi bi-stop-fill"></i>';
}

async function deleteAudioFile(filename) {
  if (!confirm(`Xóa file: ${filename}?`)) return;
  try {
    const res = await api('DELETE', `/api/audio-files/${encodeURIComponent(filename)}`);
    if (res.success) {
      showToast(`Đã xóa ${filename}`, 'success');
      refreshAudioFiles();
    } else {
      showToast('Lỗi xóa file: ' + (res.error || 'Unknown'), 'error');
    }
  } catch { showToast('Lỗi kết nối', 'error'); }
}

async function reRenderByFilename(filename) {
  if (!State.selectedStoryId) { showToast('Chọn truyện trước!', 'warning'); return; }
  // Detect episode index from filename (e.g. Tap1, tap_1, ep1...)
  const match = filename.match(/(\d+)/);
  const epIdx = match ? parseInt(match[1]) : null;
  if (!epIdx) { showToast('Không xác định được tập từ tên file', 'warning'); return; }
  showToast(`Đang render lại Tập ${epIdx}...`, 'info');
  const voiceName = document.getElementById('audio-voice').value;
  const rate = parseInt(document.getElementById('audio-rate').value);
  const volume = parseInt(document.getElementById('audio-volume').value);
  const wordsPerEp = parseInt(document.getElementById('audio-words-per-ep').value) || 0;
  try {
    const res = await api('POST', '/api/render-audio', {
      storyId: State.selectedStoryId,
      episodes: [epIdx],
      voiceName, rate, volume, wordsPerEpisode: wordsPerEp,
    });
    if (res.success) {
      showAudioRenderBar(res.total);
    } else {
      showToast('Lỗi render lại: ' + res.error, 'error');
    }
  } catch { showToast('Lỗi kết nối', 'error'); }
}

// ==========================================
// TAB 3: RENDER VIDEO
// ==========================================

async function refreshAudioSourceList() {
  await refreshAudioFiles();
  const list = document.getElementById('audio-source-list');
  if (!State.audioFiles.length) {
    list.innerHTML = '<div class="text-center text-secondary py-3" style="font-size:.75rem"><i class="bi bi-music-note-list d-block mb-1 opacity-25 fs-4"></i>Chưa có audio<br><small>Render audio ở Tab 2 trước</small></div>';
    return;
  }
  list.innerHTML = State.audioFiles.map(f => `
    <div class="media-item" draggable="true" data-type="audio" data-file="${f.filename}" ondragstart="onDragStart(event, 'audio', '${f.filename}')">
      <span class="media-item-icon">🎵</span>
      <span class="media-item-name">${f.filename}</span>
      <span class="media-item-size">${fmtSize(f.fileSizeKB)}</span>
    </div>
  `).join('');
}

async function refreshMediaFiles() {
  try {
    const res = await api('GET', '/api/video-bg-files');
    if (res.success) {
      State.videoBgFiles = res.videos || [];
      State.musicFiles = res.music || [];
      renderVideoBgList();
      renderMusicList();
    }
  } catch {}
}

function renderVideoBgList() {
  const list = document.getElementById('video-bg-source-list');
  if (!State.videoBgFiles.length) {
    list.innerHTML = '<div class="text-center text-secondary py-4" style="font-size:.75rem"><i class="bi bi-camera-video d-block mb-1 opacity-25 fs-4"></i>Chưa có video nền<br><small>Tải lên file MP4</small></div>';
    return;
  }
  list.innerHTML = State.videoBgFiles.map(f => `
    <div class="media-item" draggable="true" data-type="video-bg" data-file="${f.filename}" ondragstart="onDragStart(event, 'video-bg', '${f.filename}')">
      <span class="media-item-icon">🎬</span>
      <span class="media-item-name">${f.filename}</span>
      <span class="media-item-size">${f.sizeMB} MB</span>
    </div>
  `).join('');
}

function renderMusicList() {
  const list = document.getElementById('music-source-list');
  if (!State.musicFiles.length) {
    list.innerHTML = '<div class="text-center text-secondary py-4" style="font-size:.75rem"><i class="bi bi-music-note-beamed d-block mb-1 opacity-25 fs-4"></i>Chưa có nhạc nền<br><small>Tải lên file MP3</small></div>';
    return;
  }
  list.innerHTML = State.musicFiles.map(f => `
    <div class="media-item" draggable="true" data-type="music" data-file="${f.filename}" ondragstart="onDragStart(event, 'music', '${f.filename}')">
      <span class="media-item-icon">🎵</span>
      <span class="media-item-name">${f.filename}</span>
      <span class="media-item-size">${f.sizeMB} MB</span>
    </div>
  `).join('');
}

// Drag & Drop for audio source → mapping table
function onDragStart(event, type, filename) {
  event.dataTransfer.setData('text/plain', JSON.stringify({ type, filename }));
  event.dataTransfer.effectAllowed = 'copy';
}

function initMappingDropZone() {
  const dropHint = document.getElementById('drop-zone-main');
  if (!dropHint) return;

  dropHint.addEventListener('dragover', e => { e.preventDefault(); dropHint.classList.add('drag-over'); });
  dropHint.addEventListener('dragleave', () => dropHint.classList.remove('drag-over'));
  dropHint.addEventListener('drop', e => {
    e.preventDefault();
    dropHint.classList.remove('drag-over');
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (data.type === 'audio') addMappingRow(data.filename);
    } catch {}
  });
}

let mappingRowIdCounter = 0;
function addMappingRow(audioFilename) {
  const rowId = ++mappingRowIdCounter;
  const row = { id: rowId, audioFile: audioFilename, videoBgFile: null, musicFile: null };
  State.mappingRows.push(row);
  renderMappingTable();
  document.getElementById('btn-start-video-render').disabled = false;
}

function removeMappingRow(rowId) {
  State.mappingRows = State.mappingRows.filter(r => r.id !== rowId);
  renderMappingTable();
  if (!State.mappingRows.length) document.getElementById('btn-start-video-render').disabled = true;
}

function renderMappingTable() {
  const tbody = document.getElementById('mapping-tbody');
  if (!State.mappingRows.length) {
    tbody.innerHTML = `<tr id="mapping-drop-hint-row"><td colspan="6" class="p-1"><div class="drop-zone-main text-center py-4" id="drop-zone-main"><i class="bi bi-arrow-down-circle fs-4 d-block mb-2 opacity-25"></i><span style="font-size:.8rem">Kéo audio từ cột bên trái để tạo hàng ghép</span></div></td></tr>`;
    initMappingDropZone();
    return;
  }
  tbody.innerHTML = State.mappingRows.map((row, i) => `
    <tr data-row-id="${row.id}">
      <td class="mapping-row-num">${i + 1}</td>
      <td>
        <div class="mapping-drop-cell has-item">🎵 ${row.audioFile.length > 25 ? row.audioFile.substring(0,25)+'...' : row.audioFile}</div>
      </td>
      <td>
        <div class="mapping-drop-cell ${row.videoBgFile ? 'has-item' : ''}"
          ondragover="event.preventDefault(); this.classList.add('drag-over')"
          ondragleave="this.classList.remove('drag-over')"
          ondrop="onDropToCell(event, ${row.id}, 'video-bg', this)">
          ${row.videoBgFile ? '🎬 ' + (row.videoBgFile.length > 20 ? row.videoBgFile.substring(0,20)+'...' : row.videoBgFile) : '+ Thả video nền vào đây'}
        </div>
      </td>
      <td>
        <div class="mapping-drop-cell ${row.musicFile ? 'has-item' : ''}"
          ondragover="event.preventDefault(); this.classList.add('drag-over')"
          ondragleave="this.classList.remove('drag-over')"
          ondrop="onDropToCell(event, ${row.id}, 'music', this)">
          ${row.musicFile ? '🎵 ' + (row.musicFile.length > 20 ? row.musicFile.substring(0,20)+'...' : row.musicFile) : '+ Thả nhạc nền vào đây'}
        </div>
      </td>
      <td class="mapping-duration">—</td>
      <td><button class="btn-remove-row" onclick="removeMappingRow(${row.id})">✕</button></td>
    </tr>
  `).join('');
}

function onDropToCell(event, rowId, type, cell) {
  event.preventDefault();
  cell.classList.remove('drag-over');
  try {
    const data = JSON.parse(event.dataTransfer.getData('text/plain'));
    const row = State.mappingRows.find(r => r.id === rowId);
    if (!row) return;
    if (type === 'video-bg' && data.type === 'video-bg') { row.videoBgFile = data.filename; }
    else if (type === 'music' && data.type === 'music') { row.musicFile = data.filename; }
    else { showToast('Kéo đúng loại media vào ô này!', 'warning'); return; }
    renderMappingTable();
  } catch {}
}

function clearMapping() {
  State.mappingRows = [];
  renderMappingTable();
  document.getElementById('btn-start-video-render').disabled = true;
}

async function startVideoRender() {
  const readyRows = State.mappingRows.filter(r => r.videoBgFile);
  if (!readyRows.length) { showToast('Thả video nền vào ít nhất 1 hàng!', 'warning'); return; }

  const musicVol = parseInt(document.getElementById('music-vol-slider').value) / 100;

  const mappings = readyRows.map(r => ({
    audioFile: r.audioFile,
    videoBgFile: r.videoBgFile,
    musicFile: r.musicFile || null,
    outputName: `${r.audioFile.replace('.mp3', '')}_video.mp4`,
  }));

  const btn = document.getElementById('btn-start-video-render');
  btn.disabled = true; btn.textContent = 'Đang ghép...';

  try {
    const res = await api('POST', '/api/render-video', { mappings, musicVolume: musicVol });
    if (res.success) {
      showToast(`Bắt đầu ghép ${res.total} video!`, 'info');
      showVideoRenderBar(res.total);
    } else {
      showToast('Error: ' + res.error, 'error');
      btn.disabled = false; btn.innerHTML = '<i class="bi bi-film me-1"></i> Ghép video';
    }
  } catch { showToast('Lỗi kết nối', 'error'); btn.disabled = false; btn.innerHTML = '<i class="bi bi-film me-1"></i> Ghép video'; }
}

function showVideoRenderBar(total) {
  const bar = document.getElementById('video-render-bar');
  bar.style.display = 'block';
  document.getElementById('video-rpb-count').textContent = `0/${total}`;
  document.getElementById('video-rpb-fill').style.width = '0%';
}

function onVideoRenderProgress(data) {
  const total = data.total || 1;
  const done = data.done || 0;
  document.getElementById('video-rpb-count').textContent = `${done}/${total}`;
  document.getElementById('video-rpb-fill').style.width = `${Math.round(done/total*100)}%`;
  document.getElementById('video-rpb-label').textContent = `Đang ghép: ${data.outputName || ''}...`;
}

function onVideoRenderComplete(data) {
  showToast('Ghép video hoàn thành!', 'success');
  const btn = document.getElementById('btn-start-video-render');
  btn.disabled = false; btn.innerHTML = '<i class="bi bi-film me-1"></i> Merge Video';
  document.getElementById('video-render-bar').style.display = 'none';
  refreshOutputVideos();
}

async function refreshOutputVideos() {
  try {
    const res = await api('GET', '/api/output-videos');
    if (res.success) {
      State.outputVideos = res.files || [];
      renderOutputVideos();
      const badge = document.getElementById('badge-video');
      if (badge) badge.textContent = State.outputVideos.length;
    }
  } catch {}
}

function renderOutputVideos() {
  const grid = document.getElementById('output-video-grid');
  if (!State.outputVideos.length) {
    grid.innerHTML = '<div class="col-12 text-center text-secondary py-4" style="font-size:.8rem"><i class="bi bi-film fs-2 d-block mb-2 opacity-25"></i>Chưa có video đầu ra</div>';
    return;
  }
  grid.innerHTML = State.outputVideos.map(f => `
    <div class="output-video-card">
      <div class="ovc-thumb" onclick="window.open('${f.url}','_blank')">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
      </div>
      <div class="ovc-body">
        <div class="ovc-name">${f.filename}</div>
        <div class="ovc-meta">${f.fileSizeMB} MB · ${new Date(f.createdAt).toLocaleDateString('vi-VN')}</div>
        <div class="ovc-actions">
          <a href="${f.url}" target="_blank" class="btn-ovc-action">▶ Xem</a>
          <a href="${f.url}" download="${f.filename}" class="btn-ovc-action">⬇ Tải xuống</a>
        </div>
      </div>
    </div>
  `).join('');
}

// ==========================================
// UPLOAD MEDIA
// ==========================================
function initFileUploads() {
  document.getElementById('file-video-bg')?.addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    showToast(`Đang tải lên ${file.name}...`, 'info');
    try {
      const res = await fetch('/api/upload-video-bg', {
        method: 'POST',
        headers: { 'Content-Type': file.type, 'x-filename': encodeURIComponent(file.name) },
        body: file,
      });
      const data = await res.json();
      if (data.success) { showToast(`Đã tải lên: ${data.filename}`, 'success'); refreshMediaFiles(); }
      else showToast('Lỗi tải lên: ' + data.error, 'error');
    } catch { showToast('Tải lên thất bại', 'error'); }
    e.target.value = '';
  });

  document.getElementById('file-music')?.addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    showToast(`Đang tải lên ${file.name}...`, 'info');
    try {
      const res = await fetch('/api/upload-music', {
        method: 'POST',
        headers: { 'Content-Type': file.type, 'x-filename': encodeURIComponent(file.name) },
        body: file,
      });
      const data = await res.json();
      if (data.success) { showToast(`Đã tải lên: ${data.filename}`, 'success'); refreshMediaFiles(); }
      else showToast('Upload error: ' + data.error, 'error');
    } catch { showToast('Upload failed', 'error'); }
    e.target.value = '';
  });
}

// ==========================================
// SETTINGS MODAL
// ==========================================
function initSettingsModal() {
  const modal = document.getElementById('settings-modal');
  const btnOpen = document.getElementById('btn-settings');
  const btnClose = document.getElementById('btn-close-settings');
  const btnCancel = document.getElementById('btn-cancel-settings');

  btnOpen?.addEventListener('click', async () => {
    modal.classList.add('open');
    const res = await api('GET', '/api/config');
    if (res.success) {
      document.getElementById('cfg-gemini').value = res.config.geminiKey || '';
      document.getElementById('cfg-apify').value = res.config.apifyToken || '';
      document.getElementById('cfg-hashtags').value = res.config.hashtags || '';
      const voiceSel = document.getElementById('cfg-voice');
      if (voiceSel) voiceSel.value = res.config.voiceName || 'vi-VN-HoaiMyNeural';
    }
  });
  btnClose?.addEventListener('click', () => modal.classList.remove('open'));
  btnCancel?.addEventListener('click', () => modal.classList.remove('open'));
  modal?.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });

  document.getElementById('form-settings')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      geminiKey: document.getElementById('cfg-gemini').value,
      apifyToken: document.getElementById('cfg-apify').value,
      hashtags: document.getElementById('cfg-hashtags').value,
      voiceName: document.getElementById('cfg-voice').value,
    };
    const res = await api('POST', '/api/config', body);
    const msg = document.getElementById('settings-save-msg');
    if (res.success) {
      if (msg) msg.textContent = '✅ Đã lưu cài đặt!';
      showToast('Đã lưu cài đặt thành công!', 'success');
      setTimeout(() => { modal.classList.remove('open'); if (msg) msg.textContent = ''; }, 1500);
    } else {
      if (msg) msg.textContent = '❌ Lỗi: ' + res.error;
    }
  });
}

// ==========================================
// SLIDER INIT
// ==========================================
function initSliders() {
  // Speed buttons
  document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const rate = parseInt(btn.dataset.rate);
      document.getElementById('audio-rate').value = rate;
      document.getElementById('rate-val').textContent = btn.textContent;
    });
  });

  const volSlider = document.getElementById('audio-volume');
  const volVal = document.getElementById('vol-val');
  if (volSlider && volVal) {
    volSlider.addEventListener('input', () => { volVal.textContent = `${volSlider.value}%`; });
  }
  const musicVolSlider = document.getElementById('music-vol-slider');
  const musicVolVal = document.getElementById('music-vol-val');
  if (musicVolSlider && musicVolVal) {
    musicVolSlider.addEventListener('input', () => { musicVolVal.textContent = `${musicVolSlider.value}%`; });
  }
}

// Media tab switch
function initMediaTabs() {
  document.querySelectorAll('.media-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.media-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const panel = btn.dataset.media;
      document.getElementById('media-video-panel').classList.toggle('active', panel === 'video');
      document.getElementById('media-music-panel').classList.toggle('active', panel === 'music');
    });
  });
}

// Preview episode content
function initEpisodePreviewSelect() {
  const sel = document.getElementById('preview-ep-select');
  const view = document.getElementById('ep-content-view');
  if (!sel || !view) return;
  sel.addEventListener('change', () => {
    const idx = parseInt(sel.value);
    if (!idx || !State.selectedStoryData) return;
    const ep = State.selectedStoryData.episodes.find(e => e.index === idx);
    view.value = ep ? ep.content : '';
    const titleEl = document.getElementById('preview-ep-title');
    if (ep && titleEl) titleEl.textContent = `Tập ${ep.index} — ${ep.wordCount} từ — ~${formatDuration(ep.estimatedDurationSeconds)}`;
  });
}

// reload episodes when words-per-ep changes
function initWordsPerEpReload() {
  const input = document.getElementById('audio-words-per-ep');
  if (!input) return;
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (State.selectedStoryId) selectAudioStory(State.selectedStoryId); }, 600);
  });
}

// ==========================================
// INIT
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  connectWS();
  initTabs();
  initSettingsModal();
  initSliders();
  initMediaTabs();
  initMappingDropZone();
  initFileUploads();
  initEpisodePreviewSelect();
  initWordsPerEpReload();

  // Tab 1 buttons
  document.getElementById('btn-new-story')?.addEventListener('click', newStory);
  document.getElementById('btn-save-story')?.addEventListener('click', saveStory);
  document.getElementById('btn-discard')?.addEventListener('click', newStory);
  document.getElementById('btn-download-srt')?.addEventListener('click', downloadStorySRT);
  document.getElementById('btn-crawl-url')?.addEventListener('click', crawlUrl);
  document.getElementById('btn-preview')?.addEventListener('click', previewEpisodes);
  document.getElementById('input-story-content')?.addEventListener('input', updateWordCount);

  // Tab 2 buttons
  document.getElementById('btn-start-audio-render')?.addEventListener('click', startAudioRender);
  document.getElementById('btn-refresh-audio')?.addEventListener('click', refreshAudioFiles);
  document.getElementById('btn-select-all-ep')?.addEventListener('click', () => selectAllEpisodes(true));
  document.getElementById('btn-deselect-all-ep')?.addEventListener('click', () => selectAllEpisodes(false));
  document.getElementById('btn-delete-all-audio')?.addEventListener('click', async () => {
    if (!confirm('Xóa tất cả file audio? Hành động này không thể hoàn tác!')) return;
    try {
      const res = await api('DELETE', '/api/audio-files/all');
      if (res.success) { showToast('Đã xóa hết audio!', 'success'); refreshAudioFiles(); }
      else showToast('Lỗi: ' + (res.error||''), 'error');
    } catch { showToast('Lỗi kết nối', 'error'); }
  });

  // Tab 3 buttons
  document.getElementById('btn-refresh-audio-tab3')?.addEventListener('click', refreshAudioSourceList);
  document.getElementById('btn-start-video-render')?.addEventListener('click', startVideoRender);
  document.getElementById('btn-clear-mapping')?.addEventListener('click', clearMapping);
  document.getElementById('btn-refresh-output')?.addEventListener('click', refreshOutputVideos);

  // Load initial data
  loadStories();
  refreshAudioFiles();
});
