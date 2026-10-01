import { useState, useEffect, useRef, useCallback } from 'react';
import EventDrawer from '../components/EventDrawer';
import type { ObserverEvent } from '../services/api';
import { ShadowLensSocket } from '../services/websocket';
import { palette } from '../theme';

interface Props {
  runId?: string | null;
}

const TECHNIQUE_COLORS: Record<string, string> = {
  safe:                     palette.silver,
  role_override:            palette.gold,
  goal_hijacking:           palette.gold,
  context_poisoning:        palette.gold,
  tool_manipulation:        palette.gold,
  cascading_amplification:  palette.gold,
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 18 }}>
          <div>
            <h2>Live Monitor</h2>
            <p>Real-time inter-agent message stream — like a network packet inspector for agent pipelines</p>
          </div>
          <div className={`monitor-live-state ${connected ? 'is-connected' : ''}`}>
            <span className="monitor-live-dot" />
            <span>{connected ? 'CONNECTED' : 'DISCONNECTED'}</span>
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

          <span style={{ fontSize: '0.8rem', color: '#A8AEB4' }}>
            {filtered.length} / {events.length} EVENTS
          </span>
        </div>
      </div>

      {/* Event log */}
      <div className="card monitor-events" style={{ padding: 0 }}>
        {/* Header row */}
        <div className="monitor-grid-head">
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
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#9AA1A7' }}>
            {events.length === 0
              ? 'Waiting for pipeline events… Start a run from the Attack Graph view.'
              : 'No events match current filters.'}
          </div>
        ) : (
          filtered.map(e => {
            const conf = e.injection_confidence;
            const rowClass = e.injection_detected ? 'injected' : conf > 0.3 ? 'medium' : 'safe';
            const techColor = TECHNIQUE_COLORS[e.injection_technique] || palette.silver;

            return (
              <div
                key={e.event_id}
                className={`event-row monitor-grid-row ${rowClass}`}
                onClick={() => setSelected(e)}
              >
                <span style={{ color: '#899097', fontFamily: 'monospace', fontSize: '0.72rem' }}>
                  {new Date(e.timestamp).toLocaleTimeString().slice(0, 8)}
                </span>
                <span style={{ color: '#A8AEB4', fontSize: '0.8rem' }}>{e.hop_index}</span>
                <span style={{ fontSize: '0.78rem', color: '#B8BFC5' }}>
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
                  color: conf > 0.7 ? palette.goldBright : conf > 0.35 ? palette.gold : palette.silver,
                  fontWeight: 600,
                }}>
                  {(conf * 100).toFixed(0)}%
                </span>
                <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#A8AEB4' }}>
                  {e.drift_score.toFixed(3)}
                </span>
                <span style={{ fontSize: '0.75rem' }}>
                  {e.goal_violated ? <span style={{ color: palette.goldBright }}>⚠</span> : <span style={{ color: palette.silver }}>✓</span>}
                </span>
                <span style={{ color: '#8F969C', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
