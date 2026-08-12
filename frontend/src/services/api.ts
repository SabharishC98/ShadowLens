// API service — typed fetch client for all ShadowLens REST endpoints

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RunSummary {
  run_id: string;
  created_at: string;
  status: string;
  technique: string;
  model: string;
  task_preview: string;
  total_hops: number;
  injections_detected: number;
  propagation_rate: number;
  goal_violated: boolean;
  furthest_propagation: number;
  max_drift_score: number;
  terminal_success: boolean;
}

export interface ObserverEvent {
  event_id: string;
  run_id: string;
  timestamp: string;
  sender_node: string;
  receiver_node: string;
  hop_index: number;
  raw_message: string;
  injection_detected: boolean;
  injection_technique: string;
  injection_confidence: number;
  all_scores: Record<string, number>;
  drift_score: number;
  drift_from_baseline: string;
  goal_violated: boolean;
  goal_violation_reason?: string;
  goal_check_method?: string;
}

export interface RunDetail {
  run_id: string;
  created_at: string;
  status: string;
  original_task: string;
  technique: string;
  model: string;
  pipeline_config: Record<string, unknown>;
  attack_config?: Record<string, unknown>;
  summary: Record<string, unknown>;
  final_output: string;
  messages: Array<{ node: string; hop: number; content: string }>;
  observer_events: ObserverEvent[];
}

export interface RunRequest {
  task: string;
  technique: string;
  injection_node_index: number;
  target_goal: string;
  false_fact: string;
  hijacked_goal: string;
  malicious_tool_params: Record<string, unknown>;
  randomize_payload: boolean;
  model: string;
  pipeline_id: string;
}

export interface ExperimentRequest {
  models: string[];
  techniques: string[];
  runs_per_cell: number;
  concurrency: number;
  base_task: string;
  target_goal: string;
  hijacked_goal: string;
  false_fact: string;
}

export interface ExperimentStatus {
  experiment_id: string;
  status: string;
  total_runs: number;
  completed_runs: number;
  failed_runs: number;
  progress_pct: number;
  results_preview: Array<Record<string, unknown>>;
}

export interface HealthStatus {
  status: string;
  classifier_mode: string;
  db_connected: boolean;
  llm_providers: string[];
  version: string;
}

// ── API methods ───────────────────────────────────────────────────────────────

export const api = {
  // Runs
  listRuns: (page = 1, limit = 50, technique?: string, model?: string) => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (technique) params.set('technique', technique);
    if (model) params.set('model', model);
    return req<RunSummary[]>(`/api/runs?${params}`);
  },

  getRun: (runId: string) => req<RunDetail>(`/api/runs/${runId}`),

  createRun: (body: RunRequest) =>
    req<{ run_id: string; status: string }>(`/api/runs`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  stopRun: (runId: string) => req(`/api/runs/${runId}/stop`, { method: 'POST' }),

  // Experiments
  startExperiment: (body: ExperimentRequest) =>
    req<{ experiment_id: string }>('/api/experiments', { method: 'POST', body: JSON.stringify(body) }),

  getExperiment: (id: string) => req<ExperimentStatus>(`/api/experiments/${id}`),

  exportExperiment: (id: string) =>
    `${BASE}/api/experiments/${id}/export`,

  // Models
  listModels: () =>
    req<{ models: Array<{ provider: string; model: string; alias: string }> }>('/api/models'),

  // Health
  health: () => req<HealthStatus>('/api/health'),
};
