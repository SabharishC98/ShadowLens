import { useState, useEffect } from 'react';
import AttackGraphView  from './views/AttackGraphView';
import LiveMonitor      from './views/LiveMonitor';
import RunHistory       from './views/RunHistory';
import ExperimentRunner from './views/ExperimentRunner';
import { api, type HealthStatus } from './services/api';
import './index.css';

type View = 'graph' | 'monitor' | 'history' | 'experiment';

const NAV_ITEMS: Array<{ id: View; label: string; icon: string }> = [
  { id: 'graph',      label: 'Attack Graph',      icon: '⬡' },
  { id: 'monitor',    label: 'Live Monitor',       icon: '◉' },
  { id: 'history',    label: 'Run History',        icon: '▤' },
  { id: 'experiment', label: 'Experiment Runner',  icon: '⊞' },
];

export default function App() {
  const [view, setView]               = useState<View>('graph');
  const [health, setHealth]           = useState<HealthStatus | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
    const interval = setInterval(() => {
      api.health().then(setHealth).catch(() => setHealth(null));
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="app-layout">

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <nav className="sidebar">

        {/* Logo */}
        <div className="sidebar-logo" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '26px 20px' }}>
          <svg width="26" height="26" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 6 L12 18 L16 12 L20 18 L26 6 L16 16 Z" fill="#d4b89e" />
            <path d="M16 16 L10 26 L16 22 L22 26 Z" fill="rgba(212, 184, 158, 0.55)" />
          </svg>
          <div>
            <div style={{ color: '#ffffff', letterSpacing: '2px', fontSize: '1rem', fontFamily: 'Montserrat, sans-serif', fontWeight: 800, textTransform: 'uppercase' }}>
              ShadowLens
            </div>
            <div style={{ color: '#d4b89e', fontSize: '0.6rem', letterSpacing: '1px', textTransform: 'uppercase', fontFamily: 'monospace', opacity: 0.7, marginTop: '2px' }}>
              Attack Core v1.0
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? 'active' : ''}`}
              onClick={() => setView(item.id)}
            >
              <span style={{ fontSize: '0.95rem', opacity: view === item.id ? 1 : 0.55 }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        {/* System status pill */}
        <div style={{
          margin: '0 14px 20px',
          padding: '14px 16px',
          border: '1px solid rgba(212, 184, 158, 0.12)',
          borderRadius: '5px',
          background: '#060606',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute', top: 14, right: 14,
            width: 7, height: 7, borderRadius: '2px',
            backgroundColor: health ? '#4a7c59' : '#9b4444',
            boxShadow: health ? '0 0 6px #4a7c59' : '0 0 6px #9b4444',
          }} />
          <span style={{ fontSize: '0.6rem', color: 'rgba(212, 184, 158, 0.5)', letterSpacing: '1px', fontFamily: 'monospace', fontWeight: 600 }}>SYS_STATUS</span>
          <span style={{ fontSize: '0.78rem', color: '#e0e0e0', fontWeight: 700, fontFamily: 'Montserrat, sans-serif' }}>
            {health ? 'ACTIVE / 4-NODE' : 'OFFLINE'}
          </span>
          <span style={{ fontSize: '0.58rem', color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>
            {health
              ? `DB:${health.db_connected ? 'OK' : 'ERR'} · ${health.classifier_mode.toUpperCase()}`
              : 'NO CONNECTION'}
          </span>
        </div>

        {/* Version */}
        <div style={{ padding: '0 14px 16px', fontSize: '0.6rem', color: 'rgba(255,255,255,0.12)', fontFamily: 'monospace', lineHeight: 1.6 }}>
          v1.0.0 · Dr. NGP Institute<br />
          Sabharish C · FYP 2026
        </div>

      </nav>

      {/* ── Main Content ─────────────────────────────────────────────────── */}
      <main className="main-content">
        {view === 'graph'      && <AttackGraphView onRunStarted={(id: string) => setActiveRunId(id)} />}
        {view === 'monitor'    && <LiveMonitor runId={activeRunId} />}
        {view === 'history'    && <RunHistory />}
        {view === 'experiment' && <ExperimentRunner />}
      </main>

    </div>
  );
}
