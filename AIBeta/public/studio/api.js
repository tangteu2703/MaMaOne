// Lớp gọi API của Studio (một nơi duy nhất làm việc với fetch)

const BASE = '/api/studio';

async function request(path, options) {
  const res = await fetch(BASE + path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {}),
});

const safeFileName = (name) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_');

export const api = {
  options: () => request('/options'),
  providers: () => request('/providers'),
  /** Bật ZeroTTS (endpoint có sẵn của server, chạy ZeroTTS/run.bat) */
  async startZeroTTS() {
    const res = await fetch('/api/zerotts/start', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.error || 'Không bật được ZeroTTS');
    return data;
  },

  stories: () => request('/stories'),
  uploadStory: (name, text) => request(`/stories?name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: text,
  }),
  deleteStory: (id) => request(`/stories/${id}`, { method: 'DELETE' }),

  music: () => request('/music'),
  async uploadMusic(file) {
    const res = await fetch(`${BASE}/music`, {
      method: 'POST',
      headers: { 'x-filename': encodeURIComponent(safeFileName(file.name)), 'Content-Type': 'application/octet-stream' },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error || 'Tải nhạc thất bại');
    return data;
  },

  jobs: () => request('/jobs'),
  job: (id) => request(`/jobs/${id}`),
  scenes: (id) => request(`/jobs/${id}/scenes`),
  createJob: (storyId, options) => request('/jobs', json('POST', { storyId, options })),
  jobAction: (id, action, body) => request(`/jobs/${id}/${action}`, json('POST', body)),
  deleteJob: (id) => request(`/jobs/${id}`, { method: 'DELETE' }),
};
