// Form "Tạo video mới": chọn truyện, giọng, nhạc, khung hình, kiểu vẽ, tuỳ chọn nâng cao
import { api } from './api.js';
import { $, $$, h, toast, storage } from './utils.js';

const STORAGE_KEY = 'studio.form.v1';
const DEFAULTS = {
  engine: 'zerotts', voiceName: '', preset: '', speed: 1, musicTracks: [], musicVolume: 0.18,
  aspect: '16:9', style: 'anime', imageProvider: 'auto', minSceneSec: 3, maxSceneSec: 6, transition: 'cut',
  quality: 'normal', fps: 25, titlePosition: 'top', mergeShort: true, titleIntro: true, storyId: '',
};

export async function initCreateForm({ onCreate }) {
  const state = storage.get(STORAGE_KEY, DEFAULTS);
  // Chuyển từ lựa chọn cũ (1 bài `music`) sang danh sách `musicTracks`
  if (state.music && !(state.musicTracks || []).length) state.musicTracks = [state.music];
  delete state.music;
  if (!Array.isArray(state.musicTracks)) state.musicTracks = [];
  let data = await api.options();
  let stories = [];
  let activeStory = null;

  const el = {
    form: $('#createForm'), createBtn: $('#createBtn'), estimate: $('#estimate'),
    file: $('#storyFile'), dropzone: $('#dropzone'), storyInfo: $('#storyInfo'),
    libraryList: $('#libraryList'), libraryCount: $('#libraryCount'), libraryBox: $('#libraryBox'),
    engineSeg: $('#engineSeg'), voice: $('#voiceSelect'), preset: $('#presetSelect'), presetField: $('#presetField'),
    speed: $('#speedRange'), speedValue: $('#speedValue'), speedField: $('#speedField'),
    previewBtn: $('#voicePreviewBtn'), previewAudio: $('#previewAudio'),
    ztHint: $('#zerottsHint'), ztHintText: $('#zerottsHintText'), ztStartBtn: $('#zerottsStartBtn'),
    musicList: $('#musicList'), musicPlaylist: $('#musicPlaylist'), musicPlayer: $('#musicPlayer'), musicCount: $('#musicCount'), musicRefresh: $('#musicRefresh'),
    musicUpload: $('#musicUpload'), musicVol: $('#musicVolume'), musicVolValue: $('#musicVolValue'), musicVolField: $('#musicVolField'),
    aspect: $('#aspectPicker'), styles: $('#styleChips'), providerHint: $('#providerHint'), imageProvider: $('#imageProvider'),
    minScene: $('#minScene'), maxScene: $('#maxScene'), transition: $('#transition'), quality: $('#quality'),
    fps: $('#fps'), titlePosition: $('#titlePosition'), mergeShort: $('#mergeShort'), titleIntro: $('#titleIntro'),
  };

  const persist = () => storage.set(STORAGE_KEY, state);
  const currentVoices = () => (state.engine === 'zerotts' ? data.zerotts.voices : data.edgeVoices);
  const fill = (select, items, value) => {
    select.replaceChildren(...items.map((i) => h('option', { value: i.value }, i.label)));
    select.value = items.some((i) => i.value === value) ? value : (items[0] ? items[0].value : '');
    return select.value;
  };

  // ── Truyện ────────────────────────────────────────────────────────────
  function renderStoryInfo(warnings = []) {
    if (!activeStory) { el.storyInfo.hidden = true; return; }
    const s = activeStory.stats || {};
    el.storyInfo.hidden = false;
    el.storyInfo.replaceChildren(
      h('div', { class: 'story-info__title' }, `✅ ${activeStory.title}`),
      h('div', { class: 'story-info__meta' }, `${s.segments || 0} đoạn · ${s.words || 0} từ · voice ước tính ~${s.estMinutes || 0} phút`),
      ...warnings.map((w) => h('div', { class: 'story-info__warn' }, `⚠️ ${w}`)),
    );
  }

  function renderLibrary() {
    el.libraryCount.textContent = stories.length;
    el.libraryList.replaceChildren(...stories.map((s) => h('li', {
      class: `library__item${s.id === state.storyId ? ' is-active' : ''}`,
      onclick: () => selectStory(s.id),
    },
    h('span', { title: s.title }, s.title),
    h('small', {}, `${(s.stats && s.stats.segments) || 0} đoạn`),
    h('button', {
      type: 'button', class: 'library__del', title: 'Xoá truyện',
      onclick: async (e) => {
        e.stopPropagation();
        await api.deleteStory(s.id);
        if (state.storyId === s.id) { state.storyId = ''; activeStory = null; renderStoryInfo(); }
        await loadStories();
        updateEstimate();
      },
    }, '✕'))));
  }

  async function loadStories() {
    stories = (await api.stories()).stories;
    activeStory = stories.find((s) => s.id === state.storyId) || null;
    if (!activeStory) state.storyId = '';
    renderLibrary();
    renderStoryInfo();
  }

  function selectStory(id, warnings = []) {
    state.storyId = id;
    activeStory = stories.find((s) => s.id === id) || null;
    persist();
    renderLibrary();
    renderStoryInfo(warnings);
    updateEstimate();
  }

  async function uploadStoryFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const res = await api.uploadStory(file.name, text);
      await loadStories();
      selectStory(res.story.id, res.warnings);
      toast(`Đã tải truyện: ${res.story.title}`);
    } catch (e) {
      toast(`Không đọc được truyện: ${e.message}`, 'err');
    }
  }

  el.file.addEventListener('change', () => { uploadStoryFile(el.file.files[0]); el.file.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.remove('is-over'); }));
  el.dropzone.addEventListener('drop', (e) => uploadStoryFile(e.dataTransfer.files[0]));

  // ── Giọng đọc ─────────────────────────────────────────────────────────
  function renderVoice() {
    $$('.segmented__btn', el.engineSeg).forEach((b) => b.classList.toggle('is-active', b.dataset.value === state.engine));
    state.voiceName = fill(el.voice, currentVoices().map((v) => ({ value: v.name, label: v.label })), state.voiceName);
    el.presetField.hidden = state.engine !== 'zerotts';
    if (state.engine !== 'zerotts') state.preset = '';
    state.preset = fill(el.preset, data.presets.map((p) => ({ value: p.id, label: p.label })), state.preset);
    el.speed.value = state.speed;
    el.speedValue.textContent = `${Number(state.speed).toFixed(2)}x`;
    el.speed.disabled = !!state.preset;
    el.speedField.style.opacity = state.preset ? 0.45 : 1;
    el.ztHint.hidden = state.engine !== 'zerotts' || data.zerotts.online;
  }

  /** Bật ZeroTTS rồi chờ tối đa 3 phút; khi online thì nạp lại đủ danh sách giọng */
  async function startZeroTTS() {
    el.ztStartBtn.disabled = true;
    el.ztHint.classList.add('is-loading');
    el.ztHintText.textContent = 'Đang bật ZeroTTS (nạp model, có thể mất 1–2 phút)...';
    try {
      await api.startZeroTTS();
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const fresh = await api.options();
        if (fresh.zerotts.online) {
          data = fresh; renderVoice();
          toast(`ZeroTTS online — ${fresh.zerotts.voices.length} giọng`);
          return;
        }
      }
      throw new Error('quá thời gian chờ');
    } catch (e) {
      toast(`Không bật được ZeroTTS: ${e.message}`, 'err');
    } finally {
      el.ztStartBtn.disabled = false;
      el.ztHint.classList.remove('is-loading');
      el.ztHintText.textContent = 'ZeroTTS chưa chạy — chỉ hiện giọng mặc định.';
    }
  }
  el.ztStartBtn.addEventListener('click', startZeroTTS);

  el.engineSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('.segmented__btn');
    if (!btn) return;
    state.engine = btn.dataset.value;
    renderVoice(); persist();
  });
  el.voice.addEventListener('change', () => { state.voiceName = el.voice.value; persist(); });
  el.preset.addEventListener('change', () => { state.preset = el.preset.value; renderVoice(); persist(); });
  el.speed.addEventListener('input', () => { state.speed = Number(el.speed.value); el.speedValue.textContent = `${state.speed.toFixed(2)}x`; persist(); });
  el.previewBtn.addEventListener('click', () => {
    if (!state.voiceName) return;
    const kind = state.engine === 'zerotts' ? 'zerotts' : 'edgetts';
    el.previewAudio.src = `/api/voice-preview/${kind}/${encodeURIComponent(state.voiceName)}`;
    el.previewAudio.play().catch(() => toast('Không phát được mẫu giọng (ZeroTTS có online không?)', 'err'));
  });

  // ── Nhạc nền: quét workspace/music, nghe thử, chọn nhiều bài theo thứ tự ──
  const fmtTrack = (sec) => (sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '--:--');
  const player = el.musicPlayer;
  let playingName = '';

  function toggleTrack(name) {
    const i = state.musicTracks.indexOf(name);
    if (i >= 0) state.musicTracks.splice(i, 1); else state.musicTracks.push(name);
    persist(); renderMusic();
  }
  function moveTrack(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= state.musicTracks.length) return;
    [state.musicTracks[i], state.musicTracks[j]] = [state.musicTracks[j], state.musicTracks[i]];
    persist(); renderMusic();
  }
  function playTrack(track) {
    if (playingName === track.name && !player.paused) { player.pause(); return; }
    if (playingName !== track.name) { playingName = track.name; player.src = track.url; }
    player.play().catch(() => {
      toast(`Không phát được "${track.name}" (file lỗi hoặc trình duyệt không hỗ trợ định dạng)`, 'err');
      playingName = ''; renderMusic();
    });
  }
  ['play', 'pause', 'ended'].forEach((ev) => player.addEventListener(ev, () => renderMusic()));

  function renderMusic() {
    const tracks = data.music || [];
    const names = new Set(tracks.map((t) => t.name));
    state.musicTracks = state.musicTracks.filter((n) => names.has(n)); // bỏ bài đã bị xoá khỏi thư mục
    const totalSec = state.musicTracks.reduce((s, n) => s + ((tracks.find((t) => t.name === n) || {}).durationSec || 0), 0);

    el.musicCount.textContent = tracks.length
      ? `${tracks.length} bài trong workspace/music · đã chọn ${state.musicTracks.length}${state.musicTracks.length ? ` (${fmtTrack(totalSec)})` : ''}`
      : 'Thư mục workspace/music trống — bấm "Tải lên" hoặc copy file nhạc vào rồi "Quét lại"';

    el.musicList.replaceChildren(...tracks.map((t) => {
      const order = state.musicTracks.indexOf(t.name);
      const isPlaying = playingName === t.name && !player.paused;
      return h('li', { class: `music-item${order >= 0 ? ' is-selected' : ''}${playingName === t.name ? ' is-playing' : ''}` },
        h('button', {
          type: 'button', class: 'music-item__play', title: isPlaying ? 'Tạm dừng' : 'Nghe thử',
          onclick: () => playTrack(t),
        }, isPlaying ? '⏸' : '▶'),
        h('button', {
          type: 'button', class: 'music-item__main', title: order >= 0 ? 'Bỏ chọn bài này' : 'Chọn để ghép vào video',
          onclick: () => toggleTrack(t.name),
        },
        h('span', { class: 'music-item__name' }, t.name),
        h('small', {}, `${fmtTrack(t.durationSec)} · ${t.sizeMB} MB`)),
        h('span', { class: 'music-item__badge' }, order >= 0 ? String(order + 1) : '+'));
    }));

    el.musicPlaylist.hidden = !state.musicTracks.length;
    el.musicPlaylist.replaceChildren(
      h('div', { class: 'music-playlist__title' }, `🎵 Thứ tự phát trong video (${state.musicTracks.length} bài, lặp vòng + chuyển bài mượt)`),
      ...state.musicTracks.map((name, i) => h('div', { class: 'music-chip' },
        h('b', {}, String(i + 1)),
        h('span', { title: name }, name),
        h('button', { type: 'button', title: 'Lên trước', disabled: i === 0, onclick: () => moveTrack(i, -1) }, '▲'),
        h('button', { type: 'button', title: 'Xuống sau', disabled: i === state.musicTracks.length - 1, onclick: () => moveTrack(i, 1) }, '▼'),
        h('button', { type: 'button', title: 'Bỏ', onclick: () => toggleTrack(name) }, '✕'))));

    const has = state.musicTracks.length > 0;
    el.musicVol.value = state.musicVolume;
    el.musicVolValue.textContent = `${Math.round(state.musicVolume * 100)}%`;
    el.musicVolField.style.opacity = has ? 1 : 0.45;
    el.musicVol.disabled = !has;
  }

  async function rescanMusic() {
    try {
      data = { ...data, music: (await api.music()).music };
      renderMusic(); persist();
      toast(`Đã quét: ${data.music.length} bài nhạc`);
    } catch (e) { toast(`Không quét được nhạc: ${e.message}`, 'err'); }
  }
  el.musicRefresh.addEventListener('click', rescanMusic);
  el.musicVol.addEventListener('input', () => { state.musicVolume = Number(el.musicVol.value); el.musicVolValue.textContent = `${Math.round(state.musicVolume * 100)}%`; persist(); });
  el.musicUpload.addEventListener('change', async () => {
    const files = [...el.musicUpload.files];
    el.musicUpload.value = '';
    if (!files.length) return;
    const added = [];
    for (const file of files) {
      try { added.push((await api.uploadMusic(file)).filename); } catch (e) { toast(`${file.name}: ${e.message}`, 'err'); }
    }
    if (!added.length) return;
    data = { ...data, music: (await api.music()).music };
    added.forEach((n) => { if (!state.musicTracks.includes(n)) state.musicTracks.push(n); });
    renderMusic(); persist();
    toast(`Đã tải ${added.length} bài nhạc`);
  });

  // ── Khung hình, kiểu vẽ, nâng cao ─────────────────────────────────────
  el.aspect.addEventListener('click', (e) => {
    const btn = e.target.closest('.aspect');
    if (!btn) return;
    state.aspect = btn.dataset.value;
    $$('.aspect', el.aspect).forEach((b) => b.classList.toggle('is-active', b === btn));
    persist();
  });

  function renderStyles() {
    if (!data.styles.some((s) => s.id === state.style)) state.style = data.defaultStyle;
    el.styles.replaceChildren(...data.styles.map((s) => h('button', {
      type: 'button', class: `chip${s.id === state.style ? ' is-active' : ''}`, dataset: { value: s.id },
      onclick: () => { state.style = s.id; renderStyles(); persist(); },
    }, s.label)));
  }

  /** Combobox nguồn ảnh: tự động xoay tua / theo loại nguồn / chọn riêng 1 model */
  function renderImageProvider() {
    const choices = data.imageChoices || [{ value: 'auto', label: '🔄 Tự động xoay tua', group: '' }];
    if (!choices.some((c) => c.value === state.imageProvider)) state.imageProvider = 'auto';
    const groups = [...new Set(choices.map((c) => c.group))];
    el.imageProvider.replaceChildren(...groups.map((g) => {
      const opts = choices.filter((c) => c.group === g).map((c) => h('option', { value: c.value }, c.label));
      return g ? h('optgroup', { label: g }, ...opts) : opts[0];
    }).flat());
    el.imageProvider.value = state.imageProvider;
    el.providerHint.textContent = state.imageProvider === 'auto'
      ? `Tự xoay tua theo ưu tiên: ${data.providerOrder.join(' → ')} (hết quota/lỗi thì tự chuyển nguồn kế tiếp, log ghi rõ model từng ảnh)`
      : 'Chỉ dùng nguồn đã chọn — nếu hết quota sẽ chờ hồi (không tự chuyển sang nguồn khác). Có thể đổi nguồn rồi bấm Tiếp tục / Tạo lại ảnh lỗi.';
  }
  el.imageProvider.addEventListener('change', () => { state.imageProvider = el.imageProvider.value; renderImageProvider(); persist(); });

  const bindAdvanced = (node, key, parse = (v) => v) => {
    node.value = state[key];
    node.addEventListener('change', () => { state[key] = parse(node.value); persist(); updateEstimate(); });
  };
  bindAdvanced(el.minScene, 'minSceneSec', Number);
  bindAdvanced(el.maxScene, 'maxSceneSec', Number);
  bindAdvanced(el.transition, 'transition');
  bindAdvanced(el.quality, 'quality');
  bindAdvanced(el.fps, 'fps', Number);
  bindAdvanced(el.titlePosition, 'titlePosition');
  [['mergeShort', el.mergeShort], ['titleIntro', el.titleIntro]].forEach(([key, node]) => {
    node.checked = !!state[key];
    node.addEventListener('change', () => { state[key] = node.checked; persist(); });
  });

  // ── Ước tính & gửi ────────────────────────────────────────────────────
  function updateEstimate() {
    el.createBtn.disabled = !activeStory;
    if (!activeStory) { el.estimate.textContent = 'Chọn truyện để xem ước tính.'; return; }
    const s = activeStory.stats || {};
    const avg = (state.minSceneSec + state.maxSceneSec) / 2;
    el.estimate.textContent = `~${s.estMinutes || 0} phút voice · tối đa ${s.segments || 0} ảnh (mỗi đoạn 1 ảnh, ngắn quá thì gộp, dài quá thì thêm hướng zoom/pan — ~${avg}s/ảnh)`;
  }

  function getOptions() {
    const { storyId, ...options } = state;
    return options;
  }

  el.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeStory) return;
    el.createBtn.disabled = true;
    try {
      const res = await api.createJob(state.storyId, getOptions());
      toast('Đã tạo job — pipeline đang chạy');
      onCreate(res.job);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      el.createBtn.disabled = !activeStory;
    }
  });

  // ── Khởi tạo ──────────────────────────────────────────────────────────
  $$('.aspect', el.aspect).forEach((b) => b.classList.toggle('is-active', b.dataset.value === state.aspect));
  renderVoice(); renderMusic(); renderStyles(); renderImageProvider();
  await loadStories();
  updateEstimate();

  return {
    getOptions,
    /** Làm mới dữ liệu động (ZeroTTS online, danh sách nhạc...) */
    async refresh() { data = await api.options(); renderVoice(); renderMusic(); renderImageProvider(); return data; },
    get data() { return data; },
  };
}
