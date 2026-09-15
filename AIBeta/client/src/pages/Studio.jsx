import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/api'

const VOICES = [
  { value: 'vi-VN-HoaiMyNeural',   label: '🎤 Hoài My (Nữ - Mềm mại)' },
  { value: 'vi-VN-NamMinhNeural',  label: '🎤 Nam Minh (Nam)' },
]

export default function Studio({ ws }) {
  const [tab, setTab] = useState('stories')
  const [stories, setStories] = useState([])
  const [selectedStory, setSelectedStory] = useState(null)
  const [storyDetail, setStoryDetail] = useState(null)
  const [audioFiles, setAudioFiles] = useState([])
  const [videoBgs, setVideoBgs] = useState([])
  const [musicFiles, setMusicFiles] = useState([])
  const [outputVideos, setOutputVideos] = useState([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  // New story form
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newGenre, setNewGenre] = useState('')
  const [wordsPerEp, setWordsPerEp] = useState(200)

  // Audio render form
  const [voiceName, setVoiceName] = useState('vi-VN-HoaiMyNeural')
  const [voiceRate, setVoiceRate] = useState(0)
  const [selectedEps, setSelectedEps] = useState([])
  const [renderingAudio, setRenderingAudio] = useState(false)
  const [audioProgress, setAudioProgress] = useState([])

  // Video render form
  const [videoMappings, setVideoMappings] = useState([])
  const [musicVolume, setMusicVolume] = useState(0.3)
  const [renderingVideo, setRenderingVideo] = useState(false)
  const [videoProgress, setVideoProgress] = useState([])

  const load = useCallback(async () => {
    try {
      const [s, a, b] = await Promise.all([
        api.getStories(),
        api.getAudioFiles(),
        api.getVideoBgFiles(),
      ])
      setStories(s.stories || [])
      setAudioFiles(a.files || [])
      setVideoBgs(b.videos || [])
      setMusicFiles(b.music || [])
    } catch (e) {
      setMsg('❌ ' + e.message)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const onAudioProg = (e) => {
      setAudioProgress(prev => {
        const idx = prev.findIndex(x => x.episodeIndex === e.detail.episodeIndex)
        if (idx >= 0) { const n = [...prev]; n[idx] = e.detail; return n }
        return [...prev, e.detail]
      })
    }
    const onAudioDone = () => { setRenderingAudio(false); load() }
    const onVideoProg = (e) => {
      setVideoProgress(prev => {
        const idx = prev.findIndex(x => x.outputName === e.detail.outputName)
        if (idx >= 0) { const n = [...prev]; n[idx] = e.detail; return n }
        return [...prev, e.detail]
      })
    }
    const onVideoDone = () => { setRenderingVideo(false); load() }

    window.addEventListener('ws:audio_render_progress', onAudioProg)
    window.addEventListener('ws:audio_render_complete', onAudioDone)
    window.addEventListener('ws:video_render_progress', onVideoProg)
    window.addEventListener('ws:video_render_complete', onVideoDone)
    return () => {
      window.removeEventListener('ws:audio_render_progress', onAudioProg)
      window.removeEventListener('ws:audio_render_complete', onAudioDone)
      window.removeEventListener('ws:video_render_progress', onVideoProg)
      window.removeEventListener('ws:video_render_complete', onVideoDone)
    }
  }, [load])

  async function loadStoryDetail(id) {
    setLoading(true)
    try {
      const d = await api.getStory(id, wordsPerEp)
      setStoryDetail(d)
      setSelectedStory(id)
      setSelectedEps([])
      setAudioProgress([])
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateStory() {
    if (!newContent || newContent.trim().length < 50) { setMsg('❌ Nội dung truyện quá ngắn!'); return }
    setLoading(true)
    try {
      const res = await api.createStory({ title: newTitle, content: newContent, genre: newGenre, wordsPerEpisode: wordsPerEp })
      setMsg(`✅ ${res.message}`)
      setNewTitle(''); setNewContent(''); setNewGenre('')
      await load()
      setTab('stories')
    } catch (e) {
      setMsg('❌ ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteStory(id) {
    if (!confirm('Xóa truyện này?')) return
    await api.deleteStory(id)
    setMsg('✅ Đã xóa truyện')
    if (selectedStory === id) { setSelectedStory(null); setStoryDetail(null) }
    await load()
  }

  async function handleRenderAudio() {
    if (!selectedStory) { setMsg('❌ Chọn truyện trước!'); return }
    setRenderingAudio(true)
    setAudioProgress([])
    try {
      const eps = selectedEps.length > 0 ? selectedEps : undefined
      await api.renderAudio({ storyId: selectedStory, episodes: eps, voiceName, rate: voiceRate, wordsPerEpisode: wordsPerEp })
      setMsg('✅ Đang render audio...')
    } catch (e) {
      setMsg('❌ ' + e.message)
      setRenderingAudio(false)
    }
  }

  function addVideoMapping() {
    setVideoMappings(prev => [...prev, { audioFile: '', videoBgFile: '', musicFile: '', outputName: '' }])
  }

  function updateMapping(idx, key, val) {
    setVideoMappings(prev => prev.map((m, i) => i === idx ? { ...m, [key]: val } : m))
  }

  async function handleRenderVideo() {
    const valid = videoMappings.filter(m => m.audioFile && m.videoBgFile)
    if (valid.length === 0) { setMsg('❌ Thêm ít nhất 1 ghép video hợp lệ!'); return }
    setRenderingVideo(true)
    setVideoProgress([])
    try {
      await api.renderVideo({ mappings: valid, musicVolume })
      setMsg('✅ Đang ghép video...')
    } catch (e) {
      setMsg('❌ ' + e.message)
      setRenderingVideo(false)
    }
  }

  async function handleDeleteAudio(filename) {
    await api.deleteAudio(filename)
    await load()
  }

  const toggleEp = (idx) => {
    setSelectedEps(prev => prev.includes(idx) ? prev.filter(x => x !== idx) : [...prev, idx])
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">🎬 Studio</h1>
        <p className="page-subtitle">Quản lý truyện · Render audio · Ghép video</p>
      </div>

      {msg && (
        <div className={`alert ${msg.startsWith('❌') ? 'alert-danger' : 'alert-success'}`}>
          {msg} <button style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }} onClick={() => setMsg('')}>✕</button>
        </div>
      )}

      <div className="tabs">
        {[['stories','📚 Truyện'],['new','➕ Thêm Truyện'],['audio','🔊 Render Audio'],['video','🎞 Ghép Video']].map(([id, label]) => (
          <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {/* ── TAB: Stories ── */}
      {tab === 'stories' && (
        <div className="grid-2">
          {/* List */}
          <div className="card">
            <div className="card-title flex-between">
              <span>📚 Danh sách truyện ({stories.length})</span>
              <button className="btn btn-secondary btn-sm" onClick={load}>↺ Refresh</button>
            </div>
            {stories.length === 0
              ? <div className="empty-state"><div className="empty-icon">📭</div><p>Chưa có truyện nào</p></div>
              : stories.map(s => (
                <div
                  key={s.id}
                  style={{
                    padding: '12px', marginBottom: 8, borderRadius: 8, cursor: 'pointer',
                    border: `1px solid ${selectedStory === s.id ? 'var(--primary)' : 'var(--border)'}`,
                    background: selectedStory === s.id ? 'var(--primary-glow)' : 'var(--bg-surface)',
                    transition: 'all 0.2s',
                  }}
                  onClick={() => loadStoryDetail(s.id)}
                >
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{s.title}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', gap: 12 }}>
                    <span>📝 {s.wordCount?.toLocaleString()} từ</span>
                    <span>🎬 {s.episodesRendered} tập đã render</span>
                  </div>
                  <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                    <button className="btn btn-danger btn-sm" onClick={e => { e.stopPropagation(); handleDeleteStory(s.id) }}>🗑 Xóa</button>
                  </div>
                </div>
              ))
            }
          </div>

          {/* Detail */}
          <div className="card">
            {!storyDetail
              ? <div className="empty-state"><div className="empty-icon">👈</div><p>Chọn truyện để xem chi tiết</p></div>
              : (
                <div>
                  <div className="card-title">📖 {storyDetail.title}</div>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    <span>📝 {storyDetail.wordCount?.toLocaleString()} từ</span>
                    <span>📚 {storyDetail.episodes?.length} tập</span>
                  </div>

                  <div style={{ marginBottom: 8, fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    Danh sách tập:
                  </div>
                  <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                    {storyDetail.episodes?.map(ep => (
                      <div
                        key={ep.index}
                        style={{
                          padding: '8px 10px', marginBottom: 4, borderRadius: 6,
                          border: `1px solid ${selectedEps.includes(ep.index) ? 'var(--primary)' : 'var(--border)'}`,
                          background: selectedEps.includes(ep.index) ? 'var(--primary-glow)' : 'var(--bg-surface)',
                          cursor: 'pointer', fontSize: '0.82rem',
                        }}
                        onClick={() => toggleEp(ep.index)}
                      >
                        <span style={{ color: 'var(--primary-light)', marginRight: 8 }}>Tập {ep.index}</span>
                        <span style={{ color: 'var(--text-secondary)' }}>{ep.title}</span>
                        <span style={{ float: 'right', color: 'var(--text-muted)' }}>{ep.wordCount} từ · ~{Math.round(ep.estimatedDurationSeconds)}s</span>
                      </div>
                    ))}
                  </div>
                  {selectedEps.length > 0 && (
                    <div style={{ marginTop: 8, fontSize: '0.82rem', color: 'var(--primary-light)' }}>
                      ✓ Đã chọn {selectedEps.length} tập
                    </div>
                  )}
                </div>
              )
            }
          </div>
        </div>
      )}

      {/* ── TAB: New Story ── */}
      {tab === 'new' && (
        <div className="card" style={{ maxWidth: 720 }}>
          <div className="card-title">➕ Thêm Truyện Mới</div>
          <div className="form-group">
            <label className="form-label">Tên truyện *</label>
            <input className="form-control" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="VD: Cô Gái Thành Thị..." />
          </div>
          <div className="form-group">
            <label className="form-label">Thể loại</label>
            <input className="form-control" value={newGenre} onChange={e => setNewGenre(e.target.value)} placeholder="Tình cảm, Hành động, Kinh dị..." />
          </div>
          <div className="form-group">
            <label className="form-label">Số từ mỗi tập</label>
            <input className="form-control" type="number" value={wordsPerEp} onChange={e => setWordsPerEp(+e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Nội dung truyện * (paste toàn bộ)</label>
            <textarea
              className="form-control"
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              rows={12}
              placeholder="Paste nội dung truyện vào đây..."
            />
            <div style={{ marginTop: 4, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {newContent.split(/\s+/).filter(Boolean).length} từ
            </div>
          </div>
          <button className="btn btn-primary" onClick={handleCreateStory} disabled={loading}>
            {loading ? <span className="spin">⟳</span> : '💾'} Lưu Truyện
          </button>
        </div>
      )}

      {/* ── TAB: Audio ── */}
      {tab === 'audio' && (
        <div className="grid-2">
          <div className="card">
            <div className="card-title">🔊 Render Audio</div>
            {!selectedStory
              ? <div className="alert alert-info">👈 Chọn truyện trong tab "Truyện" trước</div>
              : (
                <div>
                  <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--primary-glow)', borderRadius: 8, fontSize: '0.85rem', color: 'var(--primary-light)' }}>
                    📖 {storyDetail?.title} · {selectedEps.length > 0 ? `${selectedEps.length} tập được chọn` : `Tất cả ${storyDetail?.episodes?.length} tập`}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Giọng đọc</label>
                    <select className="form-control" value={voiceName} onChange={e => setVoiceName(e.target.value)}>
                      {VOICES.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tốc độ đọc: {voiceRate > 0 ? `+${voiceRate}%` : `${voiceRate}%`}</label>
                    <input type="range" min={-50} max={100} value={voiceRate} onChange={e => setVoiceRate(+e.target.value)} style={{ width: '100%', accentColor: 'var(--primary)' }} />
                  </div>
                  <button className="btn btn-primary" onClick={handleRenderAudio} disabled={renderingAudio}>
                    {renderingAudio ? <><span className="spin">⟳</span> Đang render...</> : '🔊 Bắt đầu Render Audio'}
                  </button>
                </div>
              )
            }

            {/* Audio progress */}
            {audioProgress.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div className="card-title">Tiến độ render audio</div>
                {audioProgress.map((p, i) => (
                  <div key={i} style={{ marginBottom: 6, fontSize: '0.82rem' }}>
                    <div className="flex-between" style={{ marginBottom: 3 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Tập {p.episodeIndex}</span>
                      <span className={`badge ${p.status === 'done' ? 'badge-green' : p.status === 'error' ? 'badge-red' : 'badge-yellow'}`}>
                        {p.status === 'done' ? '✅' : p.status === 'error' ? '❌' : '⟳'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {p.done}/{p.total} · {p.fileSizeKB || 0} KB · ~{p.durationSeconds || 0}s
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Audio files list */}
          <div className="card">
            <div className="card-title flex-between">
              <span>🎵 File Audio ({audioFiles.length})</span>
              <div className="flex gap-8">
                <button className="btn btn-secondary btn-sm" onClick={async () => { await load() }}>↺</button>
                <button className="btn btn-danger btn-sm" onClick={async () => { await api.deleteAllAudio(); await load() }}>🗑 Xóa tất cả</button>
              </div>
            </div>
            {audioFiles.length === 0
              ? <div className="empty-state"><div className="empty-icon">🎵</div><p>Chưa có file audio nào</p></div>
              : (
                <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                  {audioFiles.map((f, i) => (
                    <div key={i} style={{ padding: '8px', marginBottom: 4, background: 'var(--bg-surface)', borderRadius: 6, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-primary)', marginBottom: 4 }}>{f.filename}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <audio controls src={f.url} style={{ height: 28, flex: 1 }} />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{f.fileSizeKB}KB</span>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDeleteAudio(f.filename)}>🗑</button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            }
          </div>
        </div>
      )}

      {/* ── TAB: Video ── */}
      {tab === 'video' && (
        <div>
          <div className="grid-2" style={{ marginBottom: 20 }}>
            <div className="card">
              <div className="card-title">🎞 Ghép Video</div>
              <div className="form-group">
                <label className="form-label">Âm lượng nhạc nền: {Math.round(musicVolume * 100)}%</label>
                <input type="range" min={0} max={1} step={0.05} value={musicVolume} onChange={e => setMusicVolume(+e.target.value)} style={{ width: '100%', accentColor: 'var(--primary)' }} />
              </div>

              {videoMappings.map((m, i) => (
                <div key={i} style={{ padding: 12, background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 8 }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--primary-light)', marginBottom: 8, fontWeight: 600 }}>Ghép #{i + 1}</div>
                  <div className="form-group">
                    <label className="form-label">File audio</label>
                    <select className="form-control" value={m.audioFile} onChange={e => updateMapping(i, 'audioFile', e.target.value)}>
                      <option value="">-- Chọn audio --</option>
                      {audioFiles.map(f => <option key={f.filename} value={f.filename}>{f.filename}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Video nền</label>
                    <select className="form-control" value={m.videoBgFile} onChange={e => updateMapping(i, 'videoBgFile', e.target.value)}>
                      <option value="">-- Chọn video nền --</option>
                      {videoBgs.map(f => <option key={f.filename} value={f.filename}>{f.filename} ({f.sizeMB}MB)</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Nhạc nền (tuỳ chọn)</label>
                    <select className="form-control" value={m.musicFile} onChange={e => updateMapping(i, 'musicFile', e.target.value)}>
                      <option value="">-- Không có nhạc --</option>
                      {musicFiles.map(f => <option key={f.filename} value={f.filename}>{f.filename}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tên output</label>
                    <input className="form-control" value={m.outputName} onChange={e => updateMapping(i, 'outputName', e.target.value)} placeholder="VD: tap1_output.mp4" />
                  </div>
                  <button className="btn btn-danger btn-sm" onClick={() => setVideoMappings(prev => prev.filter((_, j) => j !== i))}>🗑 Xóa</button>
                </div>
              ))}

              <div className="flex gap-8" style={{ marginTop: 8 }}>
                <button className="btn btn-secondary" onClick={addVideoMapping}>➕ Thêm ghép</button>
                <button className="btn btn-primary" onClick={handleRenderVideo} disabled={renderingVideo || videoMappings.length === 0}>
                  {renderingVideo ? <><span className="spin">⟳</span> Đang ghép...</> : '🎬 Ghép Video'}
                </button>
              </div>
            </div>

            {/* Video Progress */}
            <div className="card">
              <div className="card-title">📊 Tiến độ Ghép Video</div>
              {videoProgress.length === 0
                ? <div className="empty-state"><div className="empty-icon">🎞</div><p>Chưa có tiến trình nào</p></div>
                : videoProgress.map((p, i) => (
                  <div key={i} style={{ marginBottom: 8, padding: '10px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)', fontSize: '0.82rem' }}>
                    <div className="flex-between mb-8">
                      <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{p.outputName}</span>
                      <span className={`badge ${p.status === 'done' ? 'badge-green' : p.status === 'error' ? 'badge-red' : 'badge-yellow'}`}>
                        {p.status === 'done' ? '✅ Xong' : p.status === 'error' ? '❌ Lỗi' : '⟳ Đang ghép'}
                      </span>
                    </div>
                    {p.status === 'done' && (
                      <a href={p.url} target="_blank" rel="noreferrer" className="btn btn-success btn-sm">▶ Xem Video</a>
                    )}
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
