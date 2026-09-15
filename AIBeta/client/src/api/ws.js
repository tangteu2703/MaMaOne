// ==========================================
// WebSocket Hook — Realtime từ backend
// ==========================================
import { useEffect, useRef, useState, useCallback } from 'react';

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [logs, setLogs] = useState([]);
  const [systemState, setSystemState] = useState(null);
  const [progress, setProgress] = useState(null);
  const [videoHistory, setVideoHistory] = useState([]);
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Kết nối trực tiếp đến backend port 3000
    const wsUrl = `${protocol}//localhost:3000`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      console.log('[WS] Connected');
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        switch (msg.type) {
          case 'init':
            setSystemState(msg.data.state);
            setLogs(msg.data.recentLogs || []);
            if (msg.data.activeProgress) setProgress(msg.data.activeProgress);
            if (msg.data.state?.videoHistory) setVideoHistory(msg.data.state.videoHistory);
            break;
          case 'log':
            setLogs((prev) => [msg.data, ...prev].slice(0, 200));
            break;
          case 'progress':
            setProgress(msg.data);
            break;
          case 'state_change':
            setSystemState(msg.data);
            break;
          case 'history_update':
            setVideoHistory(msg.data);
            break;
          case 'audio_render_progress':
          case 'audio_render_complete':
          case 'video_render_progress':
          case 'video_render_complete':
          case 'ai_video_created':
          case 'ai_image_step_created':
            // Emit custom event cho các page cần lắng nghe
            window.dispatchEvent(new CustomEvent(`ws:${msg.type}`, { detail: msg.data }));
            break;
          default:
            break;
        }
      } catch (e) {
        console.error('[WS] Parse error', e);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      console.log('[WS] Disconnected, reconnecting in 3s...');
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { connected, logs, systemState, progress, videoHistory };
}
