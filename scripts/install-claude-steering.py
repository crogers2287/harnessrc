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
question_script=a.release/'scripts/claude-question-hook.mjs'
if not question_script.is_file():raise SystemExit('Question hook missing from release')
question_command='RC_HOOK_SOCKET='+shlex.quote(str(a.socket))+' '+shlex.quote(shutil.which('node'))+' '+shlex.quote(str(question_script))
for event in ['PreToolUse','PostToolUse','PostToolUseFailure']:
 groups=config.setdefault('hooks',{}).setdefault(event,[])
 for group in groups:
  group['hooks']=[h for h in group.get('hooks',[]) if 'claude-question-hook.mjs' not in h.get('command','')]
 groups.append({'matcher':'AskUserQuestion|ExitPlanMode','hooks':[{'type':'command','command':question_command,'timeout':86400 if event=='PreToolUse' else 5}]})
permission_script=a.release/'scripts/claude-permission-hook.ts'
loader=a.release/'node_modules/tsx/dist/loader.mjs'
if not permission_script.is_file() or not loader.is_file():raise SystemExit('Permission hook or tsx loader missing from release')
permission_command='RC_HOOK_SOCKET='+shlex.quote(str(a.socket))+' '+shlex.quote(shutil.which('node'))+' --import '+shlex.quote(str(loader))+' '+shlex.quote(str(permission_script))
groups=config.setdefault('hooks',{}).setdefault('PermissionRequest',[])
for group in groups:
 group['hooks']=[h for h in group.get('hooks',[]) if 'claude-permission-hook.ts' not in h.get('command','')]
groups.append({'hooks':[{'type':'command','command':permission_command,'timeout':86400}]})
a.settings.parent.mkdir(parents=True,exist_ok=True)
if a.settings.exists():
 backup=a.settings.with_name(a.settings.name+'.before-relay-steering-'+str(time.time_ns()))
 shutil.copy2(a.settings,backup);os.chmod(backup,0o600)
tmp=a.settings.with_name(a.settings.name+'.relay-next')
tmp.write_text(json.dumps(config,indent=2)+'\n');os.chmod(tmp,0o600);os.replace(tmp,a.settings)
print('Installed Relay steering, question and permission hooks; existing hooks preserved.')
