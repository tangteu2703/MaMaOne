// Điểm khởi động trang Story Video Studio
import { api } from './api.js';
import { initCreateForm } from './createForm.js';
import { initJobList } from './jobList.js';
import { $, h } from './utils.js';

const SYSBAR_REFRESH_MS = 10000;

/** Thanh trạng thái hệ thống: ZeroTTS + các nguồn ảnh theo thứ tự ưu tiên */
function renderSysbar(zerottsOnline, providerInfo) {
  const pills = [h('span', { class: `pill ${zerottsOnline ? 'pill--ok' : 'pill--warn'}` }, `ZeroTTS ${zerottsOnline ? 'online' : 'offline (tự bật khi chạy)'}`)];
  const byKind = {};
  (providerInfo.providers || []).forEach((p) => {
    const g = byKind[p.kind] || (byKind[p.kind] = { total: 0, ready: 0 });
    g.total++;
    if (!p.cooldownSec) g.ready++;
  });
  (providerInfo.order || []).forEach((kind, i) => {
    const g = byKind[kind];
    if (!g) return;
    pills.push(h('span', { class: `pill ${g.ready ? 'pill--ok' : 'pill--warn'}`, title: 'Thứ tự ưu tiên nguồn ảnh' }, `${i + 1}. ${kind} ${g.ready}/${g.total}`));
  });
  $('#sysbar').replaceChildren(...pills);
}

async function main() {
  let jobs = null;
  const form = await initCreateForm({ onCreate: (job) => jobs.add(job) });

  jobs = initJobList({
    listEl: $('#jobList'),
    emptyEl: $('#emptyJobs'),
    countEl: $('#jobCount'),
    getFormOptions: form.getOptions,
  });

  let zerottsWasOnline = null;
  const refreshSysbar = async () => {
    try {
      const [providerInfo, data] = await Promise.all([api.providers(), api.options()]);
      renderSysbar(data.zerotts.online, providerInfo);
      // ZeroTTS mới online/offline → nạp lại danh sách giọng trong form
      if (zerottsWasOnline !== null && zerottsWasOnline !== data.zerotts.online) await form.refresh();
      zerottsWasOnline = data.zerotts.online;
    } catch { /* server đang bận */ }
  };
  refreshSysbar();
  setInterval(refreshSysbar, SYSBAR_REFRESH_MS);
}

main().catch((e) => {
  console.error(e);
  document.body.prepend(h('div', { class: 'toast toast--err' }, `Không khởi động được trang: ${e.message}`));
});
