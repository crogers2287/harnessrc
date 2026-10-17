import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

test('Codex identity hooks only register the native foreground ancestor and preserve other owners', () => {
  execFileSync(
    'python3',
    [
      '-c',
      `
import importlib.util, os
spec = importlib.util.spec_from_file_location('hook', ${JSON.stringify(path.resolve('scripts/codex-session-hook.py'))})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
os.environ['HERDR_PANE_ID']='w1:p1'; os.environ['HERDR_SOCKET_PATH']='/mock.sock'
os.environ.pop('CODEX_THREAD_ID', None)
id='11111111-1111-1111-1111-111111111111'
calls=[]
agent={'agent':'codex','terminal_id':'terminal-a','agent_session':None}
info={'foreground_process_group_id':42,'foreground_processes':[{'pid':42,'name':'codex'}]}
def request(sock, method, params):
    calls.append((method,params))
    if method=='agent.get': return {'agent':agent.copy()}
    if method=='pane.process_info': return {'process_info':info}
    return {'ok':True}
m.request=request; m.ancestors=lambda:{42,99}
payload={'session_id':id,'hook_event_name':'Stop'}
m.report(payload)
assert calls[-1][0]=='pane.report_agent_session'
assert calls[-1][1]['agent_session_id']==id
calls.clear(); m.ancestors=lambda:{99}; m.report(payload)
assert all(method!='pane.report_agent_session' for method,_ in calls)
calls.clear(); m.ancestors=lambda:{42}; agent['agent_session']={'value':'another-owner'}; m.report(payload)
assert all(method!='pane.report_agent_session' for method,_ in calls)
calls.clear(); agent['agent_session']=None; os.environ['CODEX_THREAD_ID']='another-thread'; m.report(payload)
assert not calls
`,
    ],
    { stdio: 'pipe', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } },
  );
});
