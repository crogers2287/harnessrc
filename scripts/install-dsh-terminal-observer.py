#!/usr/bin/env python3
"""Prepare/install the read-only DSH terminal observer; does not restart DSH."""
import argparse, json, os, re, shutil, time
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--profile', type=Path, required=True)
p.add_argument('--release', type=Path, required=True)
p.add_argument('--socket', type=Path, required=True)
p.add_argument('--gateway-config', type=Path, required=True)
p.add_argument('--host-id', required=True)
p.add_argument('--apply', action='store_true')
a = p.parse_args()
plugin = a.release.absolute() / 'integrations/dsh-terminal.mjs'
patch = a.profile / 'cordis.patch.yml'
if not plugin.is_file(): raise SystemExit('Observer plugin missing from release')
if not a.socket.is_absolute(): raise SystemExit('Use an absolute private socket path')
source = patch.read_text()
if re.search(r'^- id: relay-terminal-observer\s*$', source, re.M):
    raise SystemExit('Observer entry already exists; review the existing configuration')
config = json.loads(a.gateway_config.read_text())
hosts = [h for h in config.get('dsh', []) if h.get('id') == a.host_id]
if len(hosts) != 1: raise SystemExit('Choose one configured native DSH host')
# JSON string literals are valid YAML scalars; no shell command interpolation.
entry = '\n- id: relay-terminal-observer\n  name: ' + json.dumps(str(plugin)) + '\n  config:\n    socket: ' + json.dumps(str(a.socket)) + '\n'
print('Native profile addition:\n' + entry)
print('Gateway host', a.host_id, 'terminalSocket:', a.socket)
print('DSH must load the new plugin before live output is available. No service is restarted here.')
if a.apply:
    hosts[0]['terminalSocket'] = str(a.socket)
    for target, text in [(patch, source.rstrip() + '\n' + entry), (a.gateway_config, json.dumps(config, indent=2) + '\n')]:
        backup = target.with_name(target.name + '.before-relay-terminal-' + str(time.time_ns()))
        shutil.copy2(target, backup); os.chmod(backup, 0o600)
        temporary = target.with_name(target.name + '.relay-next')
        temporary.write_text(text); os.chmod(temporary, 0o600); os.replace(temporary, target)
    print('Installed native/gateway configuration; activation is still required.')
