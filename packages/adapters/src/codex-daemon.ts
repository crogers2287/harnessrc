import WebSocket from 'ws';
import { lstatSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

/** Metadata-only connection to an EXISTING daemon. Never starts/resumes a thread or turn. */
export class CodexDaemon {
  private ws?: WebSocket;
  private connecting?: Promise<void>;
  private pending = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  constructor(private socketPath: string) {}
  private async connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.connecting = (async () => {
      const stat = lstatSync(this.socketPath);
      if (!stat.isSocket() || stat.uid !== process.getuid?.() || stat.mode & 0o077)
        throw new Error('Codex daemon socket must be private and owned by the gateway user');
      const ws = new WebSocket(`ws+unix://${this.socketPath}:/`, {
        handshakeTimeout: 4000,
        maxPayload: 8 * 1024 * 1024,
      });
      this.ws = ws;
      ws.on('message', (raw) => {
        try {
          const response = JSON.parse(raw.toString());
          if (response.method) return; // This observer does not claim native interactions.
          const pending = this.pending.get(String(response.id));
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(String(response.id));
          if (response.error) pending.reject(new Error(response.error.message));
          else pending.resolve(response.result);
        } catch {
          ws.close();
        }
      });
      const disconnected = () => {
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error('Codex daemon disconnected'));
        }
        this.pending.clear();
      };
      ws.on('close', disconnected);
      ws.on('error', disconnected);
      await new Promise<void>((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
      });
      await this.send('initialize', {
        clientInfo: { name: 'relay_herdr_link', title: 'Relay', version: '0.1.0' },
        capabilities: { experimentalApi: true },
      });
      ws.send(JSON.stringify({ method: 'initialized' }));
    })();
    try {
      await this.connecting;
    } catch (error) {
      this.ws?.close();
      throw error;
    } finally {
      this.connecting = undefined;
    }
  }
  private send(method: string, params: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out`));
      }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify({ id, method, params }), (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }
  async request(method: 'thread/read' | 'thread/loaded/list' | 'thread/name/set', params: unknown) {
    await this.connect();
    return this.send(method, params);
  }
  close() {
    this.ws?.close();
  }
}
