import { useState } from 'react';
import type { ObserverEvent } from '../services/api';
import { palette } from '../theme';

interface Props {
  event: ObserverEvent;
  onClose: () => void;
}

export default function EventDrawer({ event, onClose }: Props) {
  const [tab, setTab] = useState<'overview' | 'scores' | 'message'>('overview');

  const conf = event.injection_confidence;
  const confColor = conf > 0.7 ? palette.goldBright : conf > 0.35 ? palette.gold : palette.silver;

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h3 style={{ marginBottom: 4 }}>
              {event.sender_node} → {event.receiver_node}
            </h3>
            <span style={{ fontSize: '0.75rem', color: '#8A9197' }}>Hop {event.hop_index} · {new Date(event.timestamp).toLocaleTimeString()}</span>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#B8BFC5', cursor: 'pointer', fontSize: '1.2rem' }}
          >✕</button>
        </div>

        {/* Status banners */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          <span className={`badge ${event.injection_detected ? 'badge-high' : 'badge-safe'}`}>
            {event.injection_detected ? `⚡ ${event.injection_technique}` : '✓ Safe'}
          </span>
          <span className={`badge badge-${event.drift_from_baseline}`}>
            Drift: {event.drift_score.toFixed(3)} ({event.drift_from_baseline})
          </span>
          {event.goal_violated && (
            <span className="badge badge-critical">⚠ Goal Violated</span>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
          {(['overview', 'scores', 'message'] as const).map(t => (
            <button
              key={t}
              className={`btn btn-secondary drawer-tab ${tab === t ? 'active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Row label="Technique" value={event.injection_technique} />
            <Row label="Confidence">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: confColor, fontWeight: 700, fontFamily: 'monospace' }}>
                  {(event.injection_confidence * 100).toFixed(1)}%
                </span>
                <div style={{ flex: 1, background: 'rgba(255,255,255,0.07)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                  <div style={{ width: `${event.injection_confidence * 100}%`, height: '100%', background: confColor, borderRadius: 4, transition: 'width 0.3s' }} />
                </div>
              </div>
            </Row>
            <Row label="Drift Score" value={`${event.drift_score.toFixed(4)} (${event.drift_from_baseline})`} />
            <Row label="Goal Violated" value={event.goal_violated ? '⚠ YES' : '✓ No'} />
            {event.goal_violation_reason && (
              <Row label="Violation Reason" value={event.goal_violation_reason} />
            )}
            <Row label="Goal Check Method" value={event.goal_check_method || '—'} />
          </div>
        )}

        {tab === 'scores' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Object.entries(event.all_scores).map(([label, score]) => (
              <div key={label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: '0.8rem', color: '#B8BFC5' }}>{label}</span>
                  <span style={{ fontSize: '0.8rem', fontFamily: 'monospace', color: score > 0.5 ? palette.goldBright : palette.silver }}>
                    {(score * 100).toFixed(1)}%
                  </span>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 4, height: 5, overflow: 'hidden' }}>
                  <div style={{
                    width: `${score * 100}%`, height: '100%', borderRadius: 4,
                    background: score > 0.5 ? palette.goldBright : score > 0.2 ? palette.gold : palette.silver,
                    transition: 'width 0.3s',
                  }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'message' && (
          <div>
            <div className="drawer-message">
              {event.raw_message}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
      <span style={{ fontSize: '0.78rem', color: '#899097', minWidth: 140 }}>{label}</span>
      <span style={{ fontSize: '0.82rem', color: '#E1E3E5', textAlign: 'right', flex: 1 }}>
        {children || value}
      </span>
    </div>
  );
}
