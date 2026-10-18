#!/usr/bin/env python3
"""Add Relay identity reporting beside existing Codex hooks; back up before writing."""
import json
import os
from pathlib import Path
import shlex
import shutil
import time

home = Path(os.environ.get('CODEX_HOME', Path.home() / '.codex'))
file = home / 'hooks.json'
value = json.loads(file.read_text()) if file.exists() else {}
command = 'python3 ' + shlex.quote(str(Path(__file__).resolve().with_name('codex-session-hook.py')))
hooks = value.setdefault('hooks', {})
for event in ('SessionStart', 'UserPromptSubmit', 'Stop', 'Interrupt'):
    rows = hooks.setdefault(event, [])
    if not any(h.get('command') == command for r in rows for h in r.get('hooks', [])):
        rows.append({'hooks': [{'type': 'command', 'command': command, 'timeout': 5}]})
if file.exists():
    shutil.copy2(file, file.with_name(f'hooks.json.before-relay-{time.time_ns()}'))
home.mkdir(parents=True, exist_ok=True)
temporary = file.with_name('hooks.json.relay-tmp')
temporary.write_text(json.dumps(value, indent=2) + '\n')
temporary.chmod(0o600)
temporary.replace(file)
print('Installed additive Codex identity hooks. Running sessions report on their next loaded native hook event.')
