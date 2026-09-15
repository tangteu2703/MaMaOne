import { useState, useEffect } from 'react'
import { api } from '../api/api'

export default function AIGenerator({ ws }) {
  const [topic, setTopic] = useState('Phục chế xe máy cổ hỏng thành xe mới lộng lẫy')
  const [stepCount, setStepCount] = useState(5)
  const [isVertical, setIsVertical] = useState(true)
  const [comfyStatus, setComfyStatus] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [msg, setMsg] = useState('')
  const [history, setHistory] = useState([])
  const [stepImages, setStepImages] = useState([])
  const { systemState, progress } = ws

  const isRunning = systemState?.isRunning || generating

  useEffect(() => {
    api.checkComfyStatus().then(s => setComfyStatus(s)).catch(() => setComfyStatus({ running: false }))
    api.getAIHistory().then(h => setHistory(h.history || [])).catch(() => {})
  }, [])

  useEffect(() => {
    const onImage = (e) => setStepImages(prev => [e.detail, ...prev].slice(0, 20))
    const onDone = (e) => {
      setGenerating(false)
      setHistory(prev => [e.detail, ...prev])
      setMsg('✅ Video AI đã tạo xong!')
    }
    window.addEventListener('ws:ai_image_step_created', onImage)
    window.addEventListener('ws:ai_video_created', onDone)
    return () => {
      window.removeEventListener('ws:ai_image_step_created', onImage)
      window.removeEventListener('ws:ai_video_created', onDone)
    }
  }, [])

  async function handleGenerate() {
    if (!topic.trim()) { setMsg('❌ Nhập chủ đề video!'); return }
    setGenerating(true)
    setMsg('')
    setStepImages([])
    try {
      await api.generateAIVideo({ topic, stepCount, isVertical })
      setMsg('✅ Đã kích hoạt tạo AI Video!')
    } catch (e) {
      setMsg('❌ ' + e.message)
      setGenerating(false)
    }
  }

  const pct = progress?.overallPercent || 0

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">🤖 AI Generator</h1>
        <p className="page-subtitle">Tạo video AI tự động từ chủ đề — không cần TikTok scraper</p>
      </div>

      {/* ComfyUI Status */}
      <div className="card section">
        <div className="flex-between">
          <div className="card-title">🖥 ComfyUI Server</div>
          <span className={`badge ${comfyStatus?.running ? 'badge-green' : 'badge-red'}`}>
            {comfyStatus?.running ? '✅ Online' : '❌ Offline'}
          </span>
        </div>
        {!comfyStatus?.running && (
          <div className="alert alert-info" style={{ marginTop: 8 }}>
            ComfyUI đang offline. Hệ thống sẽ dùng ảnh tĩnh thay thế (vẫn hoạt động).
          </div>
        )}
      </div>

      <div className="grid-2">
        {/* Form */}
        <div className="card">
          <div className="card-title">⚙️ Cấu hình Video AI</div>

          <div className="form-group">
            <label className="form-label">Chủ đề video *</label>
            <textarea
              className="form-control"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              rows={3}
              placeholder="VD: Phục chế xe máy cổ hỏng từ xác xe thành xe mới lộng lẫy..."
            />
          </div>

          <div className="form-group">
            <label className="form-label">Số bước (cảnh quay): {stepCount}</label>
            <input
              type="range" min={3} max={10} value={stepCount}
              onChange={e => setStepCount(+e.target.value)}
              style={{ width: '100%', accentColor: 'var(--primary)' }}
            />
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
              {stepCount} bước ≈ video ~{stepCount * 8}-{stepCount * 12}s
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Định dạng</label>
            <div className="flex gap-8">
              <button
                className={`btn ${isVertical ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setIsVertical(true)}
              >📱 Dọc (9:16)</button>
              <button
                className={`btn ${!isVertical ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setIsVertical(false)}
              >🖥 Ngang (16:9)</button>
            </div>
          </div>

          <button
            className="btn btn-primary btn-lg"
            onClick={handleGenerate}
            disabled={isRunning}
            style={{ width: '100%' }}
          >
            {isRunning
              ? <><span className="spin">⟳</span> Đang tạo video...</>
              : '🎬 Tạo Video AI'
            }
          </button>

          {msg && (
            <div className={`alert ${msg.startsWith('❌') ? 'alert-danger' : 'alert-success'}`} style={{ marginTop: 12 }}>
              {msg}
            </div>
          )}
        </div>

        {/* Progress */}
        <div className="card">
          <div className="card-title">📊 Tiến độ</div>
          {isRunning && (
            <div style={{ marginBottom: 16 }}>
              <div className="flex-between mb-8" style={{ fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{progress?.stepName || 'Đang xử lý...'}</span>
                <span style={{ color: 'var(--primary-light)', fontWeight: 600 }}>{pct}%</span>
              </div>
              <div className="progress-bar-wrap">
                <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
              </div>
              {progress?.details && (
                <div style={{ marginTop: 8, fontSize: '0.78rem', color: 'var(--text-muted)' }}>{progress.details}</div>
              )}
            </div>
          )}

          {/* Step Images */}
          {stepImages.length > 0 && (
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                🖼 Ảnh từng bước ({stepImages.length})
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {stepImages.slice(0, 6).map((img, i) => (
                  <div key={i} style={{
                    aspectRatio: '1', borderRadius: 8, overflow: 'hidden',
                    background: 'var(--bg-surface)', border: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', padding: 4
                  }}>
                    {img.imageUrl
                      ? <img src={img.imageUrl} alt={`Step ${i+1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : `Bước ${img.step || i+1}`
                    }
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isRunning && stepImages.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">🤖</div>
              <p>Nhập chủ đề và bấm "Tạo Video AI" để bắt đầu</p>
            </div>
          )}
        </div>
      </div>

      {/* History */}
      <div className="card section" style={{ marginTop: 20 }}>
        <div className="card-title">📜 Lịch sử AI Video ({history.length})</div>
        {history.length === 0
          ? <div className="empty-state"><div className="empty-icon">📭</div><p>Chưa có video AI nào</p></div>
          : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tiêu đề</th>
                    <th>Thời gian</th>
                    <th>Trạng thái</th>
                    <th>Video</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i}>
                      <td style={{ color: 'var(--text-primary)', fontWeight: 500, maxWidth: 300 }}>{h.title || h.id}</td>
                      <td className="mono">{h.time}</td>
                      <td><span className={`badge ${h.status === 'success' ? 'badge-green' : 'badge-red'}`}>{h.status}</span></td>
                      <td>
                        {h.videoFile && (
                          <a href={h.videoFile} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">▶ Xem</a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </div>
    </div>
  )
}
