import type { SessionView } from '@harnessrc/protocol';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const send = () =>
    fetch(url, {
      ...init,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-RC-Request': '1', ...init.headers },
    });
  let response = await send();
  if (response.status === 401 && !['/api/auth/pair', '/api/auth/refresh'].includes(url)) {
    const refresh = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-RC-Request': '1' },
    });
    if (refresh.ok) response = await send();
  }
  const body = await response.json();
  if (!response.ok) throw new ApiError(response.status, body.error ?? 'Request failed');
  return body as T;
}
export class Connection {
  socket?: WebSocket;
  stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private attempt = 0;
  constructor(
    private update: (sessions: SessionView[]) => void,
    private state: (state: 'connected' | 'reconnecting') => void,
  ) {}
  private offline = () => {
    this.state('reconnecting');
    this.socket?.close();
  };
  private online = () => {
    clearTimeout(this.timer);
    this.connect();
  };
  start() {
    this.stopped = false;
    window.addEventListener('offline', this.offline);
    window.addEventListener('online', this.online);
    this.connect();
  }
  private connect() {
    if (this.stopped) return;
    this.state('reconnecting');
    if (!navigator.onLine) return;
    this.socket = new WebSocket(
      `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`,
    );
    this.socket.onopen = () => {
      this.attempt = 0;
      this.state('connected');
    };
    this.socket.onmessage = (e) => {
      try {
        const message = JSON.parse(e.data);
        if (message.type === 'invalidate') this.update(message.sessions);
      } catch {
        this.socket?.close();
      }
    };
    this.socket.onclose = () => {
      if (this.stopped) return;
      this.state('reconnecting');
      this.timer = setTimeout(
        async () => {
          try {
            await api('/api/auth/refresh', { method: 'POST' });
          } catch {
            /* Query state reports expired authentication. */
          }
          this.connect();
        },
        Math.min(15000, 1000 * 2 ** this.attempt++) + Math.random() * 300,
      );
    };
  }
  stop() {
    this.stopped = true;
    window.removeEventListener('offline', this.offline);
    window.removeEventListener('online', this.online);
    clearTimeout(this.timer);
    this.socket?.close();
  }
}
