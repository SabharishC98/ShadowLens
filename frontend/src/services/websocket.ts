// WebSocket client with reconnect logic and typed event emission

const WS_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000')
  .replace(/^http/, 'ws');

type Listener<T> = (data: T) => void;

export class ShadowLensSocket {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Listener<unknown>[]> = new Map();
  private reconnectDelay = 1000;
  private shouldReconnect = true;
  private runId: string;

  constructor(runId: string) {
    this.runId = runId;
    this.connect();
  }

  private connect() {
    const url = `${WS_BASE}/ws/runs/${this.runId}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.emit('connected', {});
    };

    this.ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        const type = data.type || 'observer_event';
        this.emit(type, data);
        // Always emit raw for components that listen to all events
        this.emit('*', data);
      } catch { /* ignore parse errors */ }
    };

    this.ws.onclose = () => {
      this.emit('disconnected', {});
      if (this.shouldReconnect) {
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10000);
      }
    };

    this.ws.onerror = () => {
      this.emit('error', { message: 'WebSocket error' });
    };
  }

  on<T>(event: string, listener: Listener<T>) {
    const arr = this.listeners.get(event) || [];
    arr.push(listener as Listener<unknown>);
    this.listeners.set(event, arr);
    return () => this.off(event, listener);  // returns unsubscribe fn
  }

  off<T>(event: string, listener: Listener<T>) {
    const arr = this.listeners.get(event) || [];
    this.listeners.set(event, arr.filter(l => l !== (listener as Listener<unknown>)));
  }

  private emit(event: string, data: unknown) {
    (this.listeners.get(event) || []).forEach(l => l(data));
  }

  send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    this.ws?.close();
  }
}

export class ExperimentSocket {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Listener<unknown>[]> = new Map();
  private shouldReconnect = true;

  constructor(experimentId: string) {
    const url = `${WS_BASE}/ws/experiments/${experimentId}`;
    this.ws = new WebSocket(url);
    this.ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        const type = data.type || 'event';
        (this.listeners.get(type) || []).forEach(l => l(data));
        (this.listeners.get('*') || []).forEach(l => l(data));
      } catch { /* ignore */ }
    };
  }

  on<T>(event: string, listener: Listener<T>) {
    const arr = this.listeners.get(event) || [];
    arr.push(listener as Listener<unknown>);
    this.listeners.set(event, arr);
  }

  disconnect() {
    this.shouldReconnect = false;
    this.ws?.close();
  }
}
