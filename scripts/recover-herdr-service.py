#!/usr/bin/env python3
"""Activate a prepared Herdr recovery, explicitly, from outside its cgroup.

The private recovery directory must contain manifest.json, herdr-0.9.5,
herdr-0.8.0.backup and herdr-state/. Defaults to validation only.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time


def systemctl(*args):
    return subprocess.check_output(['systemctl', '--user', *args], text=True).strip()


def request(path, method):
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(3)
        connection.connect(str(path))
        connection.sendall(json.dumps({'id': 'recovery-check', 'method': method, 'params': {}}).encode() + b'\n')
        data = b''
        while b'\n' not in data:
            part = connection.recv(65536)
            if not part:
                raise RuntimeError('Herdr closed the API connection')
            data += part
            if len(data) > 8 * 1024 * 1024:
                raise RuntimeError('Herdr response exceeds recovery check limit')
        message = json.loads(data.split(b'\n', 1)[0])
        if 'error' in message:
            raise RuntimeError('Herdr API returned an error')
        return message['result']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--apply', action='store_true', help='replace binary and restart all Herdr-owned processes')
    args = parser.parse_args()
    os.umask(0o077)
    root = args.directory.resolve()
    if root.stat().st_uid != os.getuid() or root.stat().st_mode & 0o077:
        raise RuntimeError('Recovery directory must be private and owned by this user')
    manifest = json.loads((root / 'manifest.json').read_text())
    target = Path.home() / '.local/bin/herdr'
    candidate = root / 'herdr-0.9.5'
    if hashlib.sha256(candidate.read_bytes()).hexdigest() != manifest['newSha256']:
        raise RuntimeError('Staged binary digest changed')
    if hashlib.sha256(target.read_bytes()).hexdigest() != manifest['oldSha256']:
        raise RuntimeError('Installed binary changed; prepare a fresh recovery')
    if hashlib.sha256((root / 'herdr-0.8.0.backup').read_bytes()).hexdigest() != manifest['oldSha256']:
        raise RuntimeError('Original binary backup is missing or changed')
    if not (root / 'herdr-state/session.json').is_file():
        raise RuntimeError('Session backup missing')
    pid = int(systemctl('show', 'herdr-server.service', '-p', 'MainPID', '--value'))
    if pid != manifest['mainPid']:
        raise RuntimeError('Server PID changed; inspect it before recovery')
    group = systemctl('show', 'herdr-server.service', '-p', 'ControlGroup', '--value')
    own_group = Path('/proc/self/cgroup').read_text().strip().split('::')[-1]
    if own_group == group or own_group.startswith(group + '/'):
        raise RuntimeError('Run recovery from an independent user service, outside Herdr')
    print(json.dumps({'validated': True, 'apply': args.apply, 'oldPid': pid}), flush=True)
    if not args.apply:
        return

    # Refresh the layout immediately before stopping; native histories stay in
    # their original stores. Never rewrite layout or inject approval answers.
    state = Path.home() / '.config/herdr'
    for source in state.rglob('*'):
        if source.is_file() and not source.is_symlink() and source.name in ('session.json', 'config.toml'):
            backup = root / 'state-at-restart' / source.relative_to(state)
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, backup)
            backup.chmod(0o600)
    temporary = target.with_name('herdr.recovery-new')
    if temporary.exists() or temporary.is_symlink():
        raise RuntimeError('Temporary install path already exists')
    with temporary.open('xb') as output:
        output.write(candidate.read_bytes())
        output.flush()
        os.fsync(output.fileno())
    temporary.chmod(0o755)
    os.replace(temporary, target)
    systemctl('daemon-reload')
    subprocess.run(['systemctl', '--user', 'restart', 'herdr-server.service'], check=True, timeout=120)
    socket_path = state / 'herdr.sock'
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        try:
            request(socket_path, 'ping')
            snapshot = request(socket_path, 'session.snapshot')
            (root / 'snapshot-after.json').write_text(json.dumps(snapshot, indent=2) + '\n')
            result = systemctl('show', 'herdr-server.service', '-p', 'MainPID', '-p', 'TasksCurrent', '-p', 'MemoryCurrent')
            print(result, flush=True)
            print('Herdr API recovered; inspect restored agents before resending work.', flush=True)
            return
        except (OSError, ValueError, KeyError, RuntimeError):
            time.sleep(1)
    raise RuntimeError('Recovery unconfirmed. Inspect the service; no automatic rollback/restart loop was attempted.')


if __name__ == '__main__':
    main()
