#!/usr/bin/env python3
"""Install permission choices verified against Fred's Claude and Codex CLI help.
Does not change defaults or permissions on any running session.
"""
import argparse, json, os, shutil, time
from pathlib import Path
p = argparse.ArgumentParser()
p.add_argument('--config', type=Path, default=Path.home()/'.config/relay/config.json')
a = p.parse_args()
config = json.loads(a.config.read_text())
for profile in config.get('launchProfiles', []):
    if profile.get('harness') == 'claude':
        profile['permissionPresets'] = [
            dict(id='manual', name='Ask before actions', description='Claude asks before actions that need permission.', args=['--permission-mode', 'manual']),
            dict(id='accept-edits', name='Accept file edits', description='Allow file edits automatically; other actions follow Claude’s permission checks.', args=['--permission-mode', 'acceptEdits']),
            dict(id='plan', name='Plan', description='Plan the work before executing changes.', args=['--permission-mode', 'plan']),
            dict(id='bypass', name='Bypass permissions', description='Allow actions without Claude permission prompts. Use only for work you trust.', args=['--dangerously-skip-permissions']),
        ]
    elif profile.get('harness') == 'codex':
        profile['permissionPresets'] = [
            dict(id='read-only', name='Read only', description='Read project files; request approval when broader access is needed.', args=['--sandbox','read-only','--ask-for-approval','on-request'], sandbox='read-only', approvalPolicy='on-request'),
            dict(id='workspace', name='Workspace access', description='Write in the workspace; request approval for broader access.', args=['--sandbox','workspace-write','--ask-for-approval','on-request'], sandbox='workspace-write', approvalPolicy='on-request'),
            dict(id='full-access', name='Full access / bypass approvals', description='Run commands without sandbox restrictions or approval prompts.', args=['--sandbox','danger-full-access','--ask-for-approval','never'], sandbox='danger-full-access', approvalPolicy='never'),
        ]
backup = a.config.with_name(a.config.name+'.before-launch-permissions-'+str(time.time_ns()))
shutil.copy2(a.config, backup)
os.chmod(backup,0o600)
tmp = a.config.with_name(a.config.name+'.permissions-next')
tmp.write_text(json.dumps(config,indent=2)+'\n'); os.chmod(tmp,0o600); os.replace(tmp,a.config)
print('Configured launch permission choices; defaults unchanged.')
