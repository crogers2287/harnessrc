#!/usr/bin/env python3
"""Merge a Relay stdio MCP connection and skill without deleting existing servers."""
import argparse, json, os, shutil, tempfile, time
from pathlib import Path
from urllib.parse import urlparse

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--client', choices=['claude', 'hermes'], required=True)
p.add_argument('--settings', type=Path, required=True, help='Claude JSON or Hermes YAML configuration')
p.add_argument('--release', type=Path, required=True)
p.add_argument('--url', required=True, help='Verified Relay Tailscale HTTPS origin')
p.add_argument('--skill-dir', type=Path, required=True, help='Client skills root')
p.add_argument('--read-only', action='store_true')
a = p.parse_args()
u = urlparse(a.url)
if u.scheme != 'https' or u.username or u.password or u.query or u.fragment or u.path not in ['', '/']:
    p.error('Use an HTTPS origin without credentials or paths')
release = a.release.absolute()
for item in ['apps/mcp/src/main.ts', 'node_modules/tsx/dist/loader.mjs', 'skills/use-relay/SKILL.md']:
    if not (release/item).is_file():
        p.error(f'Release missing {item}; install dependencies first')
node = shutil.which('node')
if not node:
    p.error('Node.js is required')
entry = {'command': node, 'args': ['--import', str(release/'node_modules/tsx/dist/loader.mjs'), str(release/'apps/mcp/src/main.ts')], 'env': {'RELAY_URL': a.url}}
if a.read_only:
    entry['env']['RELAY_READ_ONLY'] = '1'
text = a.settings.read_text() if a.settings.exists() else ''
if a.client == 'hermes':
    import yaml
    config = yaml.safe_load(text) or {}
    key = 'mcp_servers'
else:
    config = json.loads(text) if text.strip() else {}
    key = 'mcpServers'
if not isinstance(config, dict) or not isinstance(config.get(key, {}), dict):
    p.error('Expected a configuration object and MCP server map')
servers = config.setdefault(key, {})
if 'relay' in servers and servers['relay'] != entry:
    p.error('An existing different relay entry needs manual review; no files changed')
servers['relay'] = entry
skill = a.skill_dir/'use-relay'
if skill.exists() and (not (skill/'SKILL.md').is_file() or (skill/'SKILL.md').read_bytes() != (release/'skills/use-relay/SKILL.md').read_bytes()):
    p.error('An existing different use-relay skill needs manual review; no files changed')
a.settings.parent.mkdir(parents=True, exist_ok=True)
if a.settings.exists():
    backup = a.settings.with_name(a.settings.name + '.before-relay-' + str(time.time_ns()))
    shutil.copy2(a.settings, backup)
    backup.chmod(0o600)
output = yaml.safe_dump(config, sort_keys=False, allow_unicode=True) if a.client == 'hermes' else json.dumps(config, indent=2)+'\n'
fd, temporary = tempfile.mkstemp(dir=a.settings.parent, prefix='.relay-mcp-')
try:
    with os.fdopen(fd, 'w') as file:
        file.write(output)
    os.replace(temporary, a.settings)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
a.skill_dir.mkdir(parents=True, exist_ok=True)
shutil.copytree(release/'skills/use-relay', skill, dirs_exist_ok=True)
print('Installed Relay MCP and use-relay skill; other server entries preserved. Load through your client’s normal MCP refresh/new session flow.')
