import { useState, useEffect, useRef, useCallback } from 'react';
import EventDrawer from '../components/EventDrawer';
import type { ObserverEvent } from '../services/api';
import { ShadowLensSocket } from '../services/websocket';

interface Props {
  runId?: string | null;
}

const TECHNIQUE_COLORS: Record<string, string> = {
  safe:                     '#00ff66',
  role_override:            '#ffffff',
  goal_hijacking:           '#ffffff',
  context_poisoning:        '#ffffff',
  tool_manipulation:        '#ffffff',
  cascading_amplification:  '#ffffff',
};

export default function LiveMonitor({ runId }: Props) {
  const [events, setEvents]       = useState<ObserverEvent[]>([]);
  const [selected, setSelected]   = useState<ObserverEvent | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filterTechnique, setFilter] = useState('all');
  const [filterMinConf, setMinConf]  = useState(0);
  const [connected, setConnected]    = useState(false);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const socketRef   = useRef<ShadowLensSocket | null>(null);

  const connectToRun = useCallback((id: string) => {
    socketRef.current?.disconnect();
    setEvents([]);
    const socket = new ShadowLensSocket(id);
    socketRef.current = socket;
    socket.on('connected',    () => setConnected(true));
    socket.on('disconnected', () => setConnected(false));
    socket.on<ObserverEvent>('observer_event', (evt) => {
      setEvents(prev => [...prev.slice(-500), evt]);  // cap at 500
    });
  }, []);

  useEffect(() => {
    if (runId) connectToRun(runId);
    return () => socketRef.current?.disconnect();
  }, [runId, connectToRun]);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events, autoScroll]);

  const filtered = events.filter(e => {
    if (filterTechnique !== 'all' && e.injection_technique !== filterTechnique) return false;
    if (e.injection_confidence < filterMinConf) return false;
    return true;
  });

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2>Live Monitor</h2>
            <p>Real-time inter-agent message stream — like a network packet inspector for agent pipelines</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: connected ? '#00ff66' : '#ff003c',
              boxShadow: connected ? '0 0 10px rgba(0, 255, 102, 0.6)' : '0 0 10px rgba(255, 0, 60, 0.6)',
            }} />
            <span style={{ fontSize: '0.8rem', color: 'rgba(0, 255, 102, 0.65)' }}>
              {connected ? 'CONNECTED' : 'DISCONNECTED'}
            </span>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="card" style={{ marginBottom: 16, padding: '14px 18px' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label className="form-label" style={{ marginBottom: 0 }}>Technique</label>
            <select
              className="form-select"
              style={{ width: 180 }}
              value={filterTechnique}
              onChange={e => setFilter(e.target.value)}
            >
              <option value="all">All</option>
              <option value="safe">Safe</option>
              <option value="role_override">Role Override</option>
              <option value="goal_hijacking">Goal Hijacking</option>
              <option value="context_poisoning">Context Poisoning</option>
              <option value="tool_manipulation">Tool Manipulation</option>
              <option value="cascading_amplification">Cascading Amplification</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label className="form-label" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>
              Min Confidence: {filterMinConf.toFixed(1)}
            </label>
            <input
              type="range" className="slider" min={0} max={1} step={0.05}
              value={filterMinConf}
              onChange={e => setMinConf(parseFloat(e.target.value))}
              style={{ width: 120 }}
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.85rem', color: '#94a3b8' }}>
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={e => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>

          <button
            className="btn btn-secondary"
            style={{ marginLeft: 'auto', fontSize: '0.8rem', padding: '6px 14px' }}
            onClick={() => setEvents([])}
          >
            Clear
          </button>

          <span style={{ fontSize: '0.8rem', color: 'rgba(0, 255, 102, 0.45)' }}>
            {filtered.length} / {events.length} EVENTS
          </span>
        </div>
      </div>

      {/* Event log */}
      <div className="card" style={{ padding: 0, maxHeight: 600, overflowY: 'auto' }}>
        {/* Header row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '60px 30px 200px 180px 100px 80px 60px 1fr',
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
          fontSize: '0.7rem', color: 'rgba(0, 255, 102, 0.45)', textTransform: 'uppercase', letterSpacing: '0.5px',
          position: 'sticky', top: 0, background: 'var(--bg-surface)', zIndex: 1,
        }}>
          <span>Time</span>
          <span>Hop</span>
          <span>Route</span>
          <span>Technique</span>
          <span>Confidence</span>
          <span>Drift</span>
          <span>Goal</span>
          <span>Message preview</span>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#475569' }}>
            {events.length === 0
              ? 'Waiting for pipeline events… Start a run from the Attack Graph view.'
              : 'No events match current filters.'}
          </div>
        ) : (
          filtered.map(e => {
            const conf = e.injection_confidence;
            const rowClass = e.injection_detected ? 'injected' : conf > 0.3 ? 'medium' : 'safe';
            const techColor = TECHNIQUE_COLORS[e.injection_technique] || '#94a3b8';

            return (
              <div
                key={e.event_id}
                className={`event-row ${rowClass}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '60px 30px 200px 180px 100px 80px 60px 1fr',
                  gap: 0,
                }}
                onClick={() => setSelected(e)}
              >
                <span style={{ color: '#475569', fontFamily: 'monospace', fontSize: '0.72rem' }}>
                  {new Date(e.timestamp).toLocaleTimeString().slice(0, 8)}
                </span>
                <span style={{ color: '#64748b', fontSize: '0.8rem' }}>{e.hop_index}</span>
                <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                  {e.sender_node.slice(0, 5)} → {e.receiver_node.slice(0, 5)}
                </span>
                <span>
                  <span className="badge" style={{
                    background: `${techColor}20`,
                    color: techColor,
                    border: `1px solid ${techColor}40`,
                    fontSize: '0.66rem',
                  }}>
                    {e.injection_technique.replace(/_/g, ' ')}
                  </span>
                </span>
                <span style={{
                  fontFamily: 'monospace', fontSize: '0.8rem',
                  color: conf > 0.7 ? '#ff003c' : conf > 0.35 ? '#fbbf24' : '#00ff66',
                  fontWeight: 600,
                }}>
                  {(conf * 100).toFixed(0)}%
                </span>
                <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#64748b' }}>
                  {e.drift_score.toFixed(3)}
                </span>
                <span style={{ fontSize: '0.75rem' }}>
                  {e.goal_violated ? <span style={{ color: '#ff003c' }}>⚠</span> : <span style={{ color: '#00ff66' }}>✓</span>}
                </span>
                <span style={{ color: '#64748b', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.raw_message.slice(0, 100)}
                </span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {selected && <EventDrawer event={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
