// Thẻ theo dõi 1 job: 4 bước (xanh khi xong), bản đồ ảnh, nguồn ảnh/model, ảnh mới nhất, log, video kết quả
import { api } from './api.js';
import { h, fmtDuration, fmtClock, fmtDateTime, toast } from './utils.js';

const STEPS = [
  { key: 'voice', icon: '🎙️', name: 'Giọng đọc' },
  { key: 'images', icon: '🖼️', name: 'Tạo ảnh' },
  { key: 'subtitle', icon: '📝', name: 'Phụ đề' },
  { key: 'render', icon: '🎬', name: 'Dựng video' },
];
const STEP_LABEL = { pending: 'Chờ', running: 'Đang chạy', done: 'Xong ✓', warn: 'Xong (có lỗi)', error: 'Lỗi' };
const STATUS_LABEL = { queued: 'Đang xếp hàng', running: 'Đang chạy', paused: 'Tạm dừng', done: 'Hoàn thành', error: 'Lỗi' };
export const isActive = (status) => status === 'running' || status === 'queued';

export function createJobCard(initial, { getFormOptions, onDeleted }) {
  let current = initial;
  let logKey = '';
  let mapKey = '';
  let thumbsKey = '';
  let videoUrl = '';
  let promptsKey = '';
  let promptsLoading = false;

  // ── Khung DOM dựng 1 lần, sau đó chỉ cập nhật nội dung ──────────────
  const stepEls = Object.fromEntries(STEPS.map((s) => {
    const fill = h('div', { class: 'step__fill' });
    const state = h('span', { class: 'step__state' }, STEP_LABEL.pending);
    const msg = h('div', { class: 'step__msg' });
    const root = h('div', { class: 'step step--pending', 'data-step': s.key },
      h('div', { class: 'step__top' }, h('span', { class: 'step__icon' }, s.icon), s.name, state),
      h('div', { class: 'step__bar' }, fill), msg);
    return [s.key, { root, fill, state, msg }];
  }));
  const sceneMap = h('div', { class: 'scenemap' });
  stepEls.images.root.append(sceneMap);

  const title = h('h3', { class: 'job__title' });
  const status = h('span', { class: 'status' });
  const meta = h('div', { class: 'job__meta' });
  const message = h('div', { class: 'job__message', hidden: true });
  const provRow = h('div', { class: 'insight__row' });
  const thumbs = h('div', { class: 'thumbs' });
  const logBody = h('div', { class: 'log__body' });
  const logSummary = h('summary', {}, '📜 Nhật ký chi tiết (provider / model từng ảnh)');
  const log = h('details', { class: 'log' }, logSummary, logBody);
  const video = h('video', { controls: true, preload: 'metadata' });
  const resultInfo = h('span', { class: 'tag' });
  const download = h('a', { class: 'btn btn--sm', download: '' }, '⬇ Tải video');
  const filePath = h('code', { class: 'result__path', title: 'Bấm để copy đường dẫn' });
  filePath.addEventListener('click', () => copyText(filePath.textContent, 'Copy đường dẫn file video'));
  const result = h('div', { class: 'result', hidden: true },
    h('div', { class: 'result__head' }, h('span', { class: 'result__title' }, '🎉 Video hoàn chỉnh'), resultInfo, download),
    h('div', { class: 'result__file' }, '📁 Đã tự lưu: ', filePath), video);

  // ── Bảng prompt từng ảnh (tải khi mở) ──
  const promptsBody = h('div', { class: 'prompts__body' }, 'Chưa có dữ liệu');
  const promptsSummary = h('summary', {}, '🧾 Prompt từng ảnh (xem / copy prompt cuối cùng gửi tới model)');
  const prompts = h('details', { class: 'prompts' }, promptsSummary, promptsBody);
  async function loadPrompts(force = false) {
    const job = current;
    const key = `${job.id}:${job.counts.scenes}:${job.steps.images.done}:${job.status}`;
    if (promptsLoading || (!force && key === promptsKey)) return;
    promptsLoading = true;
    try {
      const { scenes, style } = await api.scenes(job.id);
      promptsKey = key;
      promptsSummary.textContent = `🧾 Prompt từng ảnh (${scenes.length} ảnh · style: ${style === 'none' ? 'giữ nguyên' : style})`;
      promptsBody.replaceChildren(...(scenes.length ? scenes.map((s) => h('div', { class: `prompt prompt--${s.status}` },
        s.imageUrl ? h('a', { href: s.imageUrl, target: '_blank' }, h('img', { src: s.imageUrl, loading: 'lazy', alt: `Ảnh ${s.i + 1}` })) : h('div', { class: 'prompt__noimg' }, s.status === 'error' ? '❌' : '⏳'),
        h('div', { class: 'prompt__main' },
          h('div', { class: 'prompt__head' },
            h('b', {}, `#${s.i + 1}`), h('span', { class: 'tag' }, s.range), s.model || s.provider ? h('span', { class: 'tag' }, s.model || s.provider) : null,
            h('button', { class: 'btn btn--sm', onclick: () => copyText(s.finalPrompt, `Copy prompt ảnh ${s.i + 1}`) }, '📋 Copy prompt')),
          h('div', { class: 'prompt__text' }, `🎙️ ${s.text}`),
          h('div', { class: 'prompt__label' }, 'Prompt cuối cùng (gồm globalPrompt + shot + style):'),
          h('pre', { class: 'prompt__final' }, s.finalPrompt),
          s.error ? h('div', { class: 'prompt__err' }, `❌ ${s.error}`) : null))) : [h('div', {}, 'Chưa lập kế hoạch cảnh (đang ở bước giọng đọc).')]));
    } catch (err) {
      promptsBody.textContent = `Không tải được prompt: ${err.message}`;
    } finally { promptsLoading = false; }
  }
  prompts.addEventListener('toggle', () => { if (prompts.open) loadPrompts(true); });
  async function copyText(text, okMsg) {
    try { await navigator.clipboard.writeText(text); toast(okMsg, 'ok'); } catch { toast('Không copy được, hãy bôi đen và copy thủ công', 'err'); }
  }

  const run = (label, fn) => async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try { await fn(); } catch (err) { toast(`${label}: ${err.message}`, 'err'); } finally { btn.disabled = false; }
  };
  const btnPause = h('button', { class: 'btn btn--sm', onclick: run('Tạm dừng', () => api.jobAction(current.id, 'pause')) }, '⏸ Tạm dừng');
  const btnResume = h('button', {
    class: 'btn btn--sm', title: 'Tiếp tục — các ảnh còn lại dùng "Nguồn tạo ảnh" đang chọn ở form',
    onclick: run('Tiếp tục', () => api.jobAction(current.id, 'resume', { imageProvider: getFormOptions().imageProvider })),
  }, '▶ Tiếp tục');
  const btnRetry = h('button', {
    class: 'btn btn--sm', title: 'Tạo lại ảnh lỗi bằng "Nguồn tạo ảnh" đang chọn ở form',
    onclick: run('Tạo lại ảnh lỗi', () => api.jobAction(current.id, 'retry-images', { imageProvider: getFormOptions().imageProvider })),
  }, '🔁 Tạo lại ảnh lỗi');
  const btnRerender = h('button', {
    class: 'btn btn--sm', title: 'Dựng lại video với nhạc/tiêu đề/chuyển cảnh đang chọn ở form (không tạo lại voice, ảnh)',
    onclick: run('Dựng lại', () => api.jobAction(current.id, 'rerender', { options: getFormOptions() })),
  }, '🎞️ Dựng lại');
  const btnDelete = h('button', {
    class: 'btn btn--sm btn--danger',
    onclick: run('Xoá', async () => {
      if (!confirm(`Xoá job "${current.title}" và toàn bộ file (voice, ảnh, video)?`)) return;
      await api.deleteJob(current.id);
      onDeleted(current.id);
    }),
  }, '🗑 Xoá');

  const root = h('article', { class: 'card job', 'data-id': initial.id },
    h('div', { class: 'job__head' },
      h('div', {}, title, meta),
      h('div', { class: 'job__actions' }, btnPause, btnResume, btnRetry, btnRerender, btnDelete)),
    message,
    h('div', { class: 'steps' }, ...STEPS.map((s) => stepEls[s.key].root)),
    h('div', { class: 'insight' },
      h('div', { class: 'insight__row' }, h('span', { class: 'insight__label' }, 'Nguồn ảnh'), provRow),
      thumbs),
    log,
    prompts,
    result);

  // ── Cập nhật ────────────────────────────────────────────────────────
  function renderSteps(job) {
    for (const s of STEPS) {
      const st = job.steps[s.key];
      const e = stepEls[s.key];
      e.root.className = `step step--${st.status}`;
      e.state.textContent = STEP_LABEL[st.status] || st.status;
      e.fill.style.width = `${Math.round((st.status === 'done' || st.status === 'warn' ? 1 : st.percent || 0) * 100)}%`;
      const detail = st.error ? `❌ ${st.error}` : st.message;
      const count = st.total ? `${st.done || 0}/${st.total}` : '';
      e.msg.textContent = detail || count || (st.status === 'pending' ? 'Chưa bắt đầu' : '');
    }
  }

  function renderMeta(job) {
    const o = job.options;
    const tags = [
      o.aspect, o.style === 'none' ? 'giữ prompt' : o.style,
      `ảnh: ${!o.imageProvider || o.imageProvider === 'auto' ? 'xoay tua' : o.imageProvider}`,
      `${o.engine === 'zerotts' ? 'ZeroTTS' : 'Edge-TTS'}${o.voiceName ? ` · ${o.voiceName}` : ''}`,
      (o.musicTracks && o.musicTracks.length > 1) ? `♪ ${o.musicTracks.length} bài nhạc nền` : (o.music ? `♪ ${o.music}` : 'không nhạc'),
      job.counts.segments ? `${job.counts.segments} đoạn` : null,
      job.counts.scenes ? `${job.counts.scenes} ảnh` : null,
      job.totalSec ? `voice ${fmtDuration(job.totalSec)}` : null,
      fmtDateTime(job.createdAt),
    ].filter(Boolean);
    meta.replaceChildren(h('span', { class: `status status--${job.status}` }, STATUS_LABEL[job.status] || job.status), ...tags.map((t) => h('span', { class: 'tag' }, t)));
  }

  function renderSceneMap(job) {
    if (typeof job.scenesBrief !== 'string' || job.scenesBrief === mapKey) return;
    mapKey = job.scenesBrief;
    sceneMap.replaceChildren(...[...mapKey].map((c) => h('i', { class: c })));
  }

  function renderProviders(job) {
    const stats = Object.entries((job.stats && job.stats.providers) || {});
    const live = (job.providers || []).filter((p) => p.busy || p.cooldownSec > 0);
    const chips = [
      ...stats.map(([name, n]) => h('span', { class: 'prov', title: 'Số ảnh đã tạo' }, `${name} × ${n}`)),
      ...live.map((p) => h('span', { class: `prov ${p.busy ? 'prov--busy' : 'prov--cool'}` },
        p.busy ? `⚡ ${p.name}${p.model ? ` (${p.model})` : ''} đang vẽ` : `⛔ ${p.name} nghỉ ${p.cooldownSec >= 120 ? `${Math.round(p.cooldownSec / 60)}p` : `${p.cooldownSec}s`}`)),
    ];
    provRow.replaceChildren(...(chips.length ? chips : [h('span', { class: 'tag' }, 'Chưa có ảnh nào')]));
  }

  function renderThumbs(job) {
    const imgs = job.recentImages || [];
    const key = imgs.map((i) => i.url).join('|');
    if (key === thumbsKey) return;
    thumbsKey = key;
    thumbs.replaceChildren(...imgs.map((i) => h('a', { href: i.url, target: '_blank', title: `Ảnh ${i.i + 1} · ${i.provider || ''}${i.model ? ` · ${i.model}` : ''}` },
      h('img', { src: i.url, loading: 'lazy', alt: `Ảnh ${i.i + 1}` }),
      h('span', {}, `#${i.i + 1} ${i.model || i.provider || ''}`.slice(0, 26)))));
  }

  function renderLog(job) {
    if (!job.log) return;
    const last = job.log[job.log.length - 1];
    const key = `${job.log.length}:${last ? last.t : 0}`;
    if (key === logKey) return;
    logKey = key;
    const nearBottom = logBody.scrollHeight - logBody.scrollTop - logBody.clientHeight < 40;
    logBody.replaceChildren(...job.log.map((l) => h('div', { class: `log__line log__line--${l.l}` }, h('time', {}, fmtClock(l.t)), l.m)));
    if (nearBottom) logBody.scrollTop = logBody.scrollHeight;
    logSummary.textContent = `📜 Nhật ký chi tiết (${job.log.length} dòng gần nhất)`;
  }

  function renderResult(job) {
    const out = job.output;
    result.hidden = !out;
    if (!out) { videoUrl = ''; return; }
    result.classList.toggle('result--vertical', job.options.aspect === '9:16');
    if (videoUrl !== out.url) { videoUrl = out.url; video.src = `${out.url}?v=${job.updatedAt}`; }
    download.href = out.url;
    filePath.textContent = out.path || '';
    download.download = `${job.title.replace(/[\\/:*?"<>|]+/g, '').slice(0, 80) || 'video'}.mp4`;
    resultInfo.textContent = `${fmtDuration(out.durationSec)} · ${out.sizeMB} MB · ${out.width}x${out.height}${out.withMusic ? ` · nhạc nền${out.musicTracks > 1 ? ` (${out.musicTracks} bài)` : ''}` : ''}`;
  }

  function renderActions(job) {
    const active = isActive(job.status);
    const hasErrImages = typeof job.scenesBrief === 'string' && job.scenesBrief.includes('e');
    btnPause.hidden = !active;
    btnResume.hidden = !(job.status === 'paused' || job.status === 'error');
    btnRetry.hidden = active || !hasErrImages;
    btnRerender.hidden = active || !(job.status === 'done');
  }

  function update(job) {
    current = { ...current, ...job };
    job = current;
    root.className = `card job is-${job.status}`;
    title.textContent = job.title;
    renderMeta(job);
    renderSteps(job);
    renderSceneMap(job);
    renderProviders(job);
    renderThumbs(job);
    renderLog(job);
    renderResult(job);
    if (prompts.open) loadPrompts();
    renderActions(job);
    const err = job.status === 'error';
    message.hidden = !job.message;
    message.textContent = job.message || '';
    message.classList.toggle('is-error', err);
    if (isActive(job.status) && !log.dataset.touched) log.open = true;
  }
  log.addEventListener('toggle', () => { log.dataset.touched = '1'; });

  update(initial);
  return { id: initial.id, el: root, update, get data() { return current; } };
}
