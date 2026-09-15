import { useState, useEffect } from 'react'
import { api } from '../api/api'

const VOICE_OPTIONS = [
  'vi-VN-HoaiMyNeural',
  'vi-VN-NamMinhNeural',
]

export default function Settings() {
  const [cfg, setCfg] = useState(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    api.getConfig().then(r => setCfg(r.config)).catch(e => setMsg('❌ ' + e.message))
  }, [])

  function update(key, val) {
    setCfg(prev => ({ ...prev, [key]: val }))
  }

  async function handleSave() {
    setSaving(true)
    setMsg('')
    try {
      await api.saveConfig(cfg)
      setMsg('✅ Đã lưu cấu hình thành công!')
    } catch (e) {
      setMsg('❌ ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  if (!cfg) return (
    <div className="empty-state">
      <div className="spin" style={{ fontSize: '2rem' }}>⟳</div>
      <p>Đang tải cấu hình...</p>
    </div>
  )

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">⚙️ Cài Đặt</h1>
        <p className="page-subtitle">Cấu hình API keys · Pipeline · Voice</p>
      </div>

      {msg && (
        <div className={`alert ${msg.startsWith('❌') ? 'alert-danger' : 'alert-success'}`}>
          {msg}
        </div>
      )}

      <div className="grid-2">
        {/* API Keys */}
        <div className="card">
          <div className="card-title">🔑 API Keys</div>

          <div className="form-group">
            <label className="form-label">Apify API Token</label>
            <input
              className="form-control mono"
              type="password"
              value={cfg.apifyToken || ''}
              onChange={e => update('apifyToken', e.target.value)}
              placeholder="apify_api_..."
            />
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Dùng để cào video TikTok trending
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Google Gemini API Key</label>
            <input
              className="form-control mono"
              type="password"
              value={cfg.geminiKey || ''}
              onChange={e => update('geminiKey', e.target.value)}
              placeholder="AIzaSy..."
            />
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Dùng để tạo script AI và metadata
            </div>
          </div>
        </div>

        {/* Pipeline Config */}
        <div className="card">
          <div className="card-title">🎯 Pipeline Config</div>

          <div className="form-group">
            <label className="form-label">Hashtags (phân cách bởi dấu phẩy)</label>
            <input
              className="form-control"
              value={cfg.hashtags || ''}
              onChange={e => update('hashtags', e.target.value)}
              placeholder="satisfying,building,craft,woodworking"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Số video tối đa mỗi lần chạy</label>
            <input
              className="form-control"
              type="number"
              min={1} max={20}
              value={cfg.maxVideos || 3}
              onChange={e => update('maxVideos', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Lượt xem tối thiểu</label>
            <input
              className="form-control"
              type="number"
              value={cfg.minViews || 10000}
              onChange={e => update('minViews', e.target.value)}
            />
          </div>
        </div>

        {/* Story Config */}
        <div className="card">
          <div className="card-title">📖 Cấu hình Truyện</div>

          <div className="form-group">
            <label className="form-label">Tên truyện mặc định</label>
            <input
              className="form-control"
              value={cfg.storyTitle || ''}
              onChange={e => update('storyTitle', e.target.value)}
              placeholder="Câu Chuyện Của Tôi"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Số từ mỗi tập</label>
            <input
              className="form-control"
              type="number"
              value={cfg.wordsPerEpisode || 200}
              onChange={e => update('wordsPerEpisode', e.target.value)}
            />
          </div>
        </div>

        {/* Audio Config */}
        <div className="card">
          <div className="card-title">🎙 Cấu hình Audio</div>

          <div className="form-group">
            <label className="form-label">Giọng đọc mặc định</label>
            <select
              className="form-control"
              value={cfg.voiceName || ''}
              onChange={e => update('voiceName', e.target.value)}
            >
              {VOICE_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">
              Âm lượng nhạc nền: {Math.round((parseFloat(cfg.musicVolume) || 0.4) * 100)}%
            </label>
            <input
              type="range"
              min={0} max={1} step={0.05}
              value={cfg.musicVolume || 0.4}
              onChange={e => update('musicVolume', e.target.value)}
              style={{ width: '100%', accentColor: 'var(--primary)' }}
            />
          </div>
        </div>
      </div>

      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          className="btn btn-primary btn-lg"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? <><span className="spin">⟳</span> Đang lưu...</> : '💾 Lưu Cấu Hình'}
        </button>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-title">ℹ️ Thông tin hệ thống</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px', fontSize: '0.85rem' }}>
          {[
            ['Backend Port', '3000 (Express + WebSocket)'],
            ['Frontend Port', '5173 (Vite + React)'],
            ['Pipeline', 'TikTok Scraper → TTS → FFmpeg'],
            ['Scheduler', '8h, 12h, 18h mỗi ngày'],
            ['Voice Engine', 'Edge TTS (Microsoft Neural)'],
            ['Video Engine', 'FFmpeg + ComfyUI (tuỳ chọn)'],
          ].map(([k, v]) => (
            <div key={k}>
              <span style={{ color: 'var(--text-muted)', marginRight: 8 }}>{k}:</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 500 }} className="mono">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
