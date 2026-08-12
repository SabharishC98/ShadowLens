import { useState, useEffect } from 'react';
import { api, type RunSummary } from '../services/api';
import EventDrawer from '../components/EventDrawer';
import type { ObserverEvent } from '../services/api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

export default function RunHistory() {
  const [runs, setRuns]           = useState<RunSummary[]>([]);
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [loading, setLoading]     = useState(true);
  const [filterTech, setFilterTech] = useState('');
  const [filterModel, setFilterModel] = useState('');
  const [viewEvent, setViewEvent] = useState<ObserverEvent | null>(null);
  const [compareMode, setCompare] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.listRuns(1, 100, filterTech || undefined, filterModel || undefined);
      setRuns(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filterTech, filterModel]);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectedRuns = runs.filter(r => selected.has(r.run_id));

  // Build comparison chart data grouped by technique
  const compareData = (() => {
    const byTech: Record<string, Record<string, number>> = {};
    selectedRuns.forEach(r => {
      const t = r.technique || 'none';
      if (!byTech[t]) byTech[t] = {};
      byTech[t][r.model] = (byTech[t][r.model] || 0) + r.propagation_rate;
    });
    return Object.entries(byTech).map(([technique, models]) => ({
      technique: technique.replace(/_/g, ' '),
      ...models,
    }));
  })();

  const modelColors = ['#00ff66', '#00993c', '#ffffff', '#64748b'];

  const exportCSV = () => {
    const toExport = selectedRuns.length > 0 ? selectedRuns : runs;
    const headers  = ['run_id','created_at','technique','model','propagation_rate','goal_violated','furthest_propagation','max_drift_score','terminal_success'];
    const rows     = toExport.map(r => headers.map(h => (r as unknown as Record<string, unknown>)[h] ?? '').join(','));
    const csv      = [headers.join(','), ...rows].join('\n');
    const a        = document.createElement('a');
    a.href         = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download     = `shadowlens_runs_${Date.now()}.csv`;
    a.click();
  };

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2>Run History</h2>
            <p>All past pipeline runs with attack metrics. Multi-select for comparison view.</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {selected.size >= 2 && (
              <button className="btn btn-secondary" onClick={() => setCompare(!compareMode)}>
                {compareMode ? 'Hide Compare' : `Compare (${selected.size})`}
              </button>
            )}
            <button className="btn btn-secondary" onClick={exportCSV}>
              ↓ Export CSV
            </button>
            <button className="btn btn-primary" onClick={load}>↻ Refresh</button>
          </div>
        </div>
      </div>

      {/* Comparison chart */}
      {compareMode && compareData.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h3 style={{ marginBottom: 16 }}>Propagation Rate — Selected Runs</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={compareData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="technique" tick={{ fill: 'rgba(255, 255, 255, 0.75)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'rgba(255, 255, 255, 0.75)', fontSize: 11 }} domain={[0, 1]} />
              <Tooltip
                contentStyle={{ background: '#000000', border: '1px solid var(--border)', borderRadius: 0 }}
                labelStyle={{ color: '#ffffff' }}
              />
              <Legend />
              {[...new Set(selectedRuns.map(r => r.model))].map((model, i) => (
                <Bar key={model} dataKey={model} fill={modelColors[i % modelColors.length]} radius={[0,0,0,0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Filters */}
      <div className="card" style={{ padding: '12px 18px', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <select className="form-select" style={{ width: 200 }} value={filterTech}
            onChange={e => setFilterTech(e.target.value)}>
            <option value="">All Techniques</option>
            {['role_override','context_poisoning','goal_hijacking','tool_manipulation','cascading_amplification'].map(t => (
              <option key={t} value={t}>{t.replace(/_/g,' ')}</option>
            ))}
          </select>
          <select className="form-select" style={{ width: 200 }} value={filterModel}
            onChange={e => setFilterModel(e.target.value)}>
            <option value="">All Models</option>
            {['gemini/gemini-2.0-flash','groq/llama-3.3-70b-versatile','groq/llama-3.1-8b-instant'].map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <span style={{ fontSize: '0.8rem', color: 'rgba(0, 255, 102, 0.45)', marginLeft: 'auto' }}>
            {runs.length} RUNS · {selected.size} SELECTED
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0, 255, 102, 0.45)' }}>Loading runs…</div>
        ) : runs.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0, 255, 102, 0.45)' }}>
            No runs yet. Start a pipeline from the Attack Graph view.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}></th>
                <th>Time</th>
                <th>Technique</th>
                <th>Model</th>
                <th>Task</th>
                <th>Status</th>
                <th>Prop Rate</th>
                <th>Drift</th>
                <th>Goal</th>
                <th>Terminal</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(run => (
                <tr key={run.run_id} onClick={() => toggleSelect(run.run_id)}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(run.run_id)}
                      onChange={() => {}}
                      style={{ cursor: 'pointer' }}
                    />
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.6)' }}>
                    {new Date(run.created_at).toLocaleString().slice(0, 16)}
                  </td>
                  <td>
                    <span className="badge" style={{
                      background: 'rgba(0, 255, 102, 0.05)',
                      color: '#00ff66',
                      border: '1px solid rgba(0, 255, 102, 0.25)',
                      fontSize: '0.66rem'
                    }}>
                      {run.technique.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                    {run.model.split('/').pop()}
                  </td>
                  <td style={{ fontSize: '0.78rem', color: '#64748b', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {run.task_preview}
                  </td>
                  <td>
                    <span className={`badge ${run.status === 'completed' ? 'badge-safe' : 'badge-stub'}`}>
                      {run.status}
                    </span>
                  </td>
                  <td style={{
                    fontFamily: 'monospace', fontWeight: 700,
                    color: '#ffffff',
                  }}>
                    {(run.propagation_rate * 100).toFixed(0)}%
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#64748b' }}>
                    {run.max_drift_score.toFixed(3)}
                  </td>
                  <td>{run.goal_violated ? <span style={{ color: '#ff003c' }}>⚠</span> : <span style={{ color: '#00ff66' }}>✓</span>}</td>
                  <td>{run.terminal_success ? <span style={{ color: '#ff003c' }}>⚡</span> : <span style={{ color: '#00ff66' }}>✓</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
