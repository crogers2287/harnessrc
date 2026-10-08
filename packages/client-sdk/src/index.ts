import type { SessionView, Event } from '@harnessrc/protocol';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
let transportOrigin = '';
export async function selectTransport() {
  try {
    const config = await fetch('/api/connection', { signal: AbortSignal.timeout(3000) }).then((r) =>
      r.json(),
    );
    if (!config.tailnetEndpoint) return;
    const origin = new URL(config.tailnetEndpoint).origin;
    const response = await fetch(origin + '/api/auth/me', {
      credentials: 'omit',
      signal: AbortSignal.timeout(4000),
    });
    if (response.ok) transportOrigin = origin;
  } catch {
    /* Outside the tailnet, the ordinary paired transport remains available. */
  }
}
export async function api<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const send = () =>
    fetch(transportOrigin + url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(20000),
      credentials: transportOrigin ? 'omit' : 'same-origin',
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        'X-RC-Request': '1',
        ...init.headers,
      },
    });
  let response = await send();
  if (response.status === 401 && !['/api/auth/pair', '/api/auth/refresh'].includes(url)) {
    const refresh = await fetch(transportOrigin + '/api/auth/refresh', {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      credentials: transportOrigin ? 'omit' : 'same-origin',
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
    private event?: (event: Event) => void,
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
      transportOrigin
        ? transportOrigin.replace('https:', 'wss:') + '/ws'
        : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`,
    );
    this.socket.onopen = () => {
      this.attempt = 0;
      this.state('connected');
    };
    this.socket.onmessage = (e) => {
      try {
        const message = JSON.parse(e.data);
        if (message.type === 'invalidate') this.update(message.sessions);
        if (message.type === 'event') this.event?.(message.event);
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

/** Binary uploads with visible progress; the same authenticated transport as chat. */
export function uploadFile(
  sessionId: string,
  file: File,
  progress: (percent: number) => void,
): Promise<{
  attachment: { id: string; name: string; mime: string; size: number; createdAt: string };
}> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(
      'POST',
      `${transportOrigin}/api/sessions/${sessionId}/attachments?${new URLSearchParams({ name: file.name, mime: file.type || 'application/octet-stream' })}`,
    );
    request.withCredentials = !transportOrigin;
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.setRequestHeader('X-RC-Request', '1');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) progress(Math.round((event.loaded / event.total) * 100));
    };
    request.timeout = 120000;
    request.onerror = request.ontimeout = () =>
      reject(new Error('Upload interrupted. Retry this file.'));
    request.onload = () => {
      try {
        const body = JSON.parse(request.responseText);
        if (request.status < 200 || request.status >= 300)
          reject(new ApiError(request.status, body.error ?? 'Upload failed'));
        else resolve(body);
      } catch {
        reject(new Error('Upload failed. Retry this file.'));
      }
    };
    request.send(file);
  });
}

export async function downloadAttachment(sessionId: string, fileId: string): Promise<Blob> {
  const url = `${transportOrigin}/api/sessions/${sessionId}/attachments/${fileId}`;
  const send = () => fetch(url, { credentials: transportOrigin ? 'omit' : 'same-origin' });
  let response = await send();
  if (response.status === 401) {
    await api('/api/auth/refresh', { method: 'POST' });
    response = await send();
  }
  if (!response.ok) throw new Error('Attachment download failed');
  return response.blob();
}
