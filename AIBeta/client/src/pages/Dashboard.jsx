import { useState } from 'react'
import { api } from '../api/api'

export default function Dashboard({ ws }) {
  const { connected, logs, systemState, progress, videoHistory } = ws
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState('')

  const stats = systemState?.stats || {}
  const isRunning = systemState?.isRunning || running

  async function handleRun() {
    try {
      setRunning(true)
      setMsg('')
      const res = await api.runPipeline({})
      setMsg(res.message || 'Đã kích hoạt pipeline!')
    } catch (e) {
      setMsg('❌ ' + e.message)
    } finally {
      setRunning(false)
    }
  }

  async function handleReset() {
    await api.reset()
    setMsg('✅ Đã reset trạng thái!')
  }

  const pct = progress?.overallPercent || 0

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">📊 Dashboard</h1>
        <p className="page-subtitle">Trạng thái hệ thống & điều khiển pipeline realtime</p>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card purple">
          <div className="stat-icon">📦</div>
          <div className="stat-value">{stats.processedToday ?? 0}</div>
          <div className="stat-label">Đã xử lý hôm nay</div>
        </div>
        <div className="stat-card green">
          <div className="stat-icon">✅</div>
          <div className="stat-value">{stats.successToday ?? 0}</div>
          <div className="stat-label">Thành công</div>
        </div>
        <div className="stat-card red">
          <div className="stat-icon">❌</div>
          <div className="stat-value">{stats.failedToday ?? 0}</div>
          <div className="stat-label">Thất bại</div>
        </div>
        <div className="stat-card cyan">
          <div className="stat-icon">🕐</div>
          <div className="stat-value" style={{ fontSize: '1rem', paddingTop: 8 }}>
            {stats.lastRunTime || '—'}
          </div>
          <div className="stat-label">Lần chạy cuối</div>
        </div>
      </div>

      {/* Pipeline Control */}
      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="card">
          <div className="card-title">⚡ Pipeline Control</div>

          <div className="flex-between mb-16">
            <div>
              {isRunning
                ? <span className="running-badge"><span className="spin">⟳</span> Đang chạy...</span>
                : <span className="badge badge-gray">Idle</span>
              }
            </div>
            <div className="flex gap-8">
              <button
                className="btn btn-primary"
                onClick={handleRun}
                disabled={isRunning}
              >
                {isRunning ? <span className="spin">⟳</span> : '▶'} Run Now
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleReset}
                disabled={isRunning}
              >
                ↺ Reset
              </button>
            </div>
          </div>

          {/* Progress */}
          <div className="mb-8" style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            {progress?.stepName || systemState?.currentStep || 'Idle'}&nbsp;
            {pct > 0 && <span style={{ color: 'var(--primary-light)' }}>{pct}%</span>}
          </div>
          <div className="progress-bar-wrap">
            <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          {progress?.details && (
            <div style={{ marginTop: 8, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {progress.details}
            </div>
          )}

          {msg && (
            <div className={`alert ${msg.startsWith('❌') ? 'alert-danger' : 'alert-success'}`} style={{ marginTop: 12 }}>
              {msg}
            </div>
          )}
        </div>

        {/* Realtime Logs */}
        <div className="card">
          <div className="card-title flex-between">
            <span>📋 Realtime Logs</span>
            <span className={`ws-dot ${connected ? 'connected' : ''}`} style={{ width: 8, height: 8 }} />
          </div>
          <div className="log-viewer">
            {logs.length === 0 && (
              <div style={{ color: 'var(--text-muted)', padding: 8 }}>Chưa có log...</div>
            )}
            {logs.map((log, i) => (
              <div key={i} className={`log-entry ${log.level}`}>
                <span className="log-time">
                  {log.timestamp ? new Date(log.timestamp).toLocaleTimeString('vi-VN') : ''}
                </span>
                <span className="log-module">[{log.module || '?'}]</span>
                <span className="log-msg">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Video History */}
      <div className="card">
        <div className="card-title">🎬 Lịch sử Video</div>
        {videoHistory.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📭</div>
            <p>Chưa có video nào được tạo trong phiên này</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tiêu đề</th>
                  <th>Thời gian</th>
                  <th>Trạng thái</th>
                  <th>Bước</th>
                  <th>Video</th>
                </tr>
              </thead>
              <tbody>
                {videoHistory.map((v, i) => (
                  <tr key={i}>
                    <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{v.title || v.id}</td>
                    <td className="mono">{v.time}</td>
                    <td>
                      <span className={`badge ${v.status === 'success' ? 'badge-green' : 'badge-red'}`}>
                        {v.status === 'success' ? '✅ Thành công' : '❌ Thất bại'}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        {Object.values(v.steps || {}).join(' ')}
                      </span>
                    </td>
                    <td>
                      {v.videoFile && (
                        <a
                          href={v.videoFile}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-secondary btn-sm"
                        >
                          ▶ Xem
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
