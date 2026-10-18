import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { Store } from '@harnessrc/storage';
export const hash = (v: string) => createHash('sha256').update(v).digest('hex');
export type Device = { id: string; name: string; admin: number; revoked: number };
export class Auth {
  pairingKey: string;
  constructor(
    private store: Store,
    dataDir: string,
  ) {
    const file = path.join(dataDir, 'pairing-key');
    if (process.env.RC_PAIRING_KEY) {
      if (process.env.RC_PAIRING_KEY.length < 32)
        throw new Error('RC_PAIRING_KEY must contain at least 32 characters');
      this.pairingKey = process.env.RC_PAIRING_KEY;
    } else {
      if (!existsSync(file))
        writeFileSync(file, randomBytes(32).toString('base64url'), { mode: 0o600 });
      chmodSync(file, 0o600);
      this.pairingKey = readFileSync(file, 'utf8').trim();
    }
  }
  pair(key: string, name: string) {
    return this.store.transaction(() => {
      const first =
        Number(this.store.db.prepare('SELECT count(*) AS n FROM devices').get()!.n) === 0;
      const pairing = this.store.db
        .prepare("SELECT * FROM tokens WHERE hash=? AND kind='pair' AND expires>?")
        .get(hash(key), Date.now());
      const match = timingSafeEqual(Buffer.from(hash(key)), Buffer.from(hash(this.pairingKey)));
      if ((first && !match) || (!first && !pairing))
        throw new Error('Pairing key is invalid or already used');
      const id = randomUUID();
      const secret = randomBytes(32).toString('base64url');
      this.store.db
        .prepare('INSERT INTO devices VALUES(?,?,?,?,?,?)')
        .run(id, name, hash(secret), first ? 1 : 0, 0, new Date().toISOString());
      if (pairing) this.store.db.prepare('DELETE FROM tokens WHERE hash=?').run(hash(key));
      this.store.audit(id, 'device.paired', null, { name, admin: first });
      return this.issue(id);
    });
  }
  tailnetDevice(node: { id: string; name: string }): Device {
    const id = `tailscale:${node.id}`;
    let row = this.store.db.prepare('SELECT id,name,admin,revoked FROM devices WHERE id=?').get(id);
    if (!row) {
      this.store.db
        .prepare('INSERT INTO devices VALUES(?,?,?,?,?,?)')
        .run(id, node.name, hash(randomUUID()), 1, 0, new Date().toISOString());
      this.store.audit(id, 'device.tailnet', null, { name: node.name });
      row = this.store.db.prepare('SELECT id,name,admin,revoked FROM devices WHERE id=?').get(id);
    }
    if (row!.revoked) throw new Error('Tailnet device revoked');
    return row as unknown as Device;
  }
  issue(deviceId: string) {
    const access = randomBytes(32).toString('base64url');
    const refresh = randomBytes(32).toString('base64url');
    this.store.db
      .prepare('INSERT INTO tokens VALUES(?,?,?,?)')
      .run(hash(access), deviceId, Date.now() + 15 * 60 * 1000, 'access');
    this.store.db
      .prepare('INSERT INTO tokens VALUES(?,?,?,?)')
      .run(hash(refresh), deviceId, Date.now() + 30 * 24 * 60 * 60 * 1000, 'refresh');
    return { access, refresh };
  }
  authenticate(token: string | undefined, kind = 'access'): Device {
    if (!token) throw new Error('Authentication required');
    const row = this.store.db
      .prepare(
        'SELECT d.id,d.name,d.admin,d.revoked FROM tokens t JOIN devices d ON d.id=t.device_id WHERE t.hash=? AND t.expires>? AND t.kind=? AND d.revoked=0',
      )
      .get(hash(token), Date.now(), kind);
    if (!row) throw new Error('Authentication expired or device revoked');
    return row as unknown as Device;
  }
  refresh(token: string | undefined) {
    return this.store.transaction(() => {
      const device = this.authenticate(token, 'refresh');
      this.store.db.prepare('DELETE FROM tokens WHERE hash=?').run(hash(token!));
      return this.issue(device.id);
    });
  }
  allowed(d: Device, sessionId: string, control = false) {
    if (d.admin) return true;
    const grant = this.store.db
      .prepare('SELECT control FROM grants WHERE device_id=? AND session_id=?')
      .get(d.id, sessionId);
    return !!grant && (!control || grant.control === 1);
  }
  pairCode(device: Device) {
    if (!device.admin) throw new Error('Administrator required');
    const code = randomBytes(32).toString('base64url');
    this.store.db
      .prepare('INSERT INTO tokens VALUES(?,?,?,?)')
      .run(hash(code), device.id, Date.now() + 5 * 60 * 1000, 'pair');
    return code;
  }
  revoke(device: Device, id: string) {
    if (!device.admin && device.id !== id) throw new Error('Administrator required');
    this.store.db.prepare('UPDATE devices SET revoked=1 WHERE id=?').run(id);
    this.store.db.prepare('DELETE FROM tokens WHERE device_id=?').run(id);
    this.store.audit(device.id, 'device.revoked', null, { id });
  }
  grant(device: Device, id: string, sessionId: string, control: boolean) {
    if (!device.admin) throw new Error('Administrator required');
    this.store.session(sessionId);
    this.store.db
      .prepare(
        'INSERT INTO grants VALUES(?,?,?) ON CONFLICT(device_id,session_id) DO UPDATE SET control=excluded.control',
      )
      .run(id, sessionId, control ? 1 : 0);
    this.store.audit(device.id, 'permission.granted', sessionId, { deviceId: id, control });
  }
}
