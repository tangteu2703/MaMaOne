import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/api'

export default function VideoLibrary() {
  const [videos, setVideos] = useState([])
  const [outputVideos, setOutputVideos] = useState([])
  const [tab, setTab] = useState('output')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [v, ov] = await Promise.all([
        api.getVideos(),
        api.getOutputVideosList().catch(() => ({ files: [] })),
      ])
      setVideos(v.videos || [])
      setOutputVideos(ov.files || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const currentList = tab === 'output' ? outputVideos : videos

  return (
    <div>
      <div className="page-header">
        <div className="flex-between">
          <div>
            <h1 className="page-title">🗂 Thư Viện Video</h1>
            <p className="page-subtitle">Xem & tải các video đã render</p>
          </div>
          <button className="btn btn-secondary" onClick={load} disabled={loading}>
            {loading ? <span className="spin">⟳</span> : '↺'} Refresh
          </button>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'output' ? 'active' : ''}`} onClick={() => setTab('output')}>
          🎬 Video Output ({outputVideos.length})
        </button>
        <button className={`tab ${tab === 'pipeline' ? 'active' : ''}`} onClick={() => setTab('pipeline')}>
          📦 Pipeline Videos ({videos.length})
        </button>
      </div>

      {currentList.length === 0
        ? (
          <div className="empty-state">
            <div className="empty-icon">📭</div>
            <p>Chưa có video nào trong thư mục này</p>
            <p style={{ marginTop: 8, fontSize: '0.8rem' }}>
              Chạy pipeline hoặc ghép video trong Studio để tạo video
            </p>
          </div>
        )
        : (
          <div className="video-grid">
            {currentList.map((v, i) => (
              <div key={i} className="video-card">
                <video
                  className="video-thumb"
                  src={v.url}
                  muted
                  onMouseEnter={e => e.target.play()}
                  onMouseLeave={e => { e.target.pause(); e.target.currentTime = 0 }}
                />
                <div className="video-card-info">
                  <div className="video-card-name" title={v.filename}>{v.filename}</div>
                  <div className="video-card-meta">
                    {v.sizeMB ? `${v.sizeMB} MB` : v.fileSizeMB ? `${v.fileSizeMB} MB` : ''}
                    {v.createdAt && ` · ${v.createdAt}`}
                  </div>
                  <div className="flex gap-8">
                    <a
                      href={v.url}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-primary btn-sm"
                      style={{ flex: 1, justifyContent: 'center' }}
                    >
                      ▶ Xem
                    </a>
                    <a
                      href={v.url}
                      download={v.filename}
                      className="btn btn-secondary btn-sm"
                    >
                      ⬇
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      }
    </div>
  )
}
