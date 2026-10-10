#!/usr/bin/env python3
"""Merge Relay's documented hooks into Claude settings, preserving all existing hooks."""
import argparse,json,os,shlex,shutil,time
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('--release',type=Path,required=True)
p.add_argument('--socket',type=Path,required=True)
p.add_argument('--settings',type=Path,default=Path.home()/'.claude/settings.json')
a=p.parse_args()
script=a.release/'scripts/claude-steering-hook.mjs'
if not script.is_file():raise SystemExit('Build/install the Relay release first')
config=json.loads(a.settings.read_text()) if a.settings.exists() else {}
command='RC_HOOK_SOCKET='+shlex.quote(str(a.socket))+' '+shlex.quote(shutil.which('node'))+' '+shlex.quote(str(script))
for event in ['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','PostToolUseFailure','Stop']:
 groups=config.setdefault('hooks',{}).setdefault(event,[])
 for group in groups:
  group['hooks']=[h for h in group.get('hooks',[]) if 'claude-steering-hook.mjs' not in h.get('command','')]
 groups.append({'hooks':[{'type':'command','command':command,'timeout':5}]})
a.settings.parent.mkdir(parents=True,exist_ok=True)
if a.settings.exists():
 backup=a.settings.with_name(a.settings.name+'.before-relay-steering-'+str(time.time_ns()))
 shutil.copy2(a.settings,backup);os.chmod(backup,0o600)
tmp=a.settings.with_name(a.settings.name+'.relay-next')
tmp.write_text(json.dumps(config,indent=2)+'\n');os.chmod(tmp,0o600);os.replace(tmp,a.settings)
print('Installed Relay steering hooks; existing hooks preserved.')
