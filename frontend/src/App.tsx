import { useEffect, useState } from 'react';
import { Activity, FlaskConical, History, Network } from 'lucide-react';
import AttackGraphView from './views/AttackGraphView';
import LiveMonitor from './views/LiveMonitor';
import RunHistory from './views/RunHistory';
import ExperimentRunner from './views/ExperimentRunner';
import { api, type HealthStatus } from './services/api';
import './index.css';

type View = 'graph' | 'monitor' | 'history' | 'experiment';

const NAV_ITEMS = [
  { id: 'graph', label: 'Attack graph', icon: Network, code: '01' },
  { id: 'monitor', label: 'Live monitor', icon: Activity, code: '02' },
  { id: 'history', label: 'Run archive', icon: History, code: '03' },
  { id: 'experiment', label: 'Experiments', icon: FlaskConical, code: '04' },
] as const;

export default function App() {
  const [view, setView] = useState<View>('graph');
  const [health, setHealth] = useState<HealthStatus | null>(null);
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
      <nav className="sidebar" aria-label="Primary navigation">
        <div className="sidebar-logo">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M5 23 12 9l4 8 4-8 7 14-11-7-11 7Z" />
              <path d="m10 25 6-4 6 4" />
            </svg>
          </span>
          <span className="brand-lockup">
            <span className="brand-name">ShadowLens</span>
            <span className="brand-caption">Trust boundary lab</span>
          </span>
        </div>

        <div className="sidebar-section-label">Workspace</div>
        <div className="sidebar-nav">
          {NAV_ITEMS.map(({ id, label, icon: Icon, code }) => (
            <button
              key={id}
              className={`nav-item ${view === id ? 'active' : ''}`}
              onClick={() => setView(id)}
              aria-label={label}
              aria-current={view === id ? 'page' : undefined}
            >
              <Icon className="nav-icon" size={17} strokeWidth={1.7} aria-hidden="true" />
              <span className="nav-label">{label}</span>
              <span className="nav-index">{code}</span>
            </button>
          ))}
        </div>

        <div className="sidebar-spacer" />

        <section className="runtime-panel" aria-label="Backend connection status">
          <div className="runtime-label">
            <span>Runtime</span>
            <span className={`status-beacon ${health ? 'is-online' : 'is-offline'}`} />
          </div>
          <strong>{health ? 'Connected' : 'Offline'}</strong>
          <span className="runtime-detail">
            {health
              ? `DB ${health.db_connected ? 'READY' : 'DEGRADED'} · ${health.classifier_mode.toUpperCase()}`
              : 'Waiting for API connection'}
          </span>
        </section>

        <div className="sidebar-footer">
          <span>ShadowLens / 01</span>
          <span>Dr. NGP Institute · FYP 2026</span>
        </div>
      </nav>

      <main className="main-content">
        <div className="utility-bar">
          <div className="utility-path">
            <span>Security research</span>
            <span className="utility-separator">/</span>
            <span>Agent trust boundaries</span>
          </div>
          <div className="utility-meta">
            <span>Field study 014</span>
            <span className="utility-mark" aria-hidden="true" />
          </div>
        </div>

        {view === 'graph' && <AttackGraphView onRunStarted={setActiveRunId} />}
        {view === 'monitor' && <LiveMonitor runId={activeRunId} />}
        {view === 'history' && <RunHistory />}
        {view === 'experiment' && <ExperimentRunner />}
      </main>
    </div>
  );
}
