import type { HerdrClient } from '@harnessrc/herdr';
import { HerdrError } from '@harnessrc/herdr';

type Start = { name: string; kind: string; pane_id: string; args: string[]; timeout_ms: number };
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;

// Herdr agent.start only accepts canonical executables. CFR launches instead
// use the new pane's shell, then verify detection before assigning the name.
export async function startHarness(client: HerdrClient, provider: string, start: Start) {
  if (provider.toLowerCase() !== 'cfrproxy') return client.request('agent.start', start, 35000);
  const { process_info: p } = await client.request('pane.process_info', { pane_id: start.pane_id });
  if (
    !p?.shell_pid ||
    p.foreground_process_group_id !== p.shell_pid ||
    !p.foreground_processes?.length ||
    p.foreground_processes.some((v: any) => v.pid !== p.shell_pid)
  )
    throw new HerdrError('agent_pane_busy', 'New session shell is still initializing');
  const command = ['cfrproxy', start.kind, ...start.args].map(quote).join(' ');
  // One submission only. A timeout after this point is ambiguous, never retried.
  await client.request('pane.send_input', {
    pane_id: start.pane_id,
    text: command,
    keys: ['enter'],
  });
  const deadline = Date.now() + start.timeout_ms;
  while (Date.now() < deadline) {
    try {
      const { agent } = await client.request('agent.get', { target: start.pane_id });
      if (agent?.agent === start.kind) {
        await client.request('agent.rename', { target: start.pane_id, name: start.name });
        return;
      }
    } catch (e) {
      if (!(e instanceof HerdrError) || e.code !== 'agent_not_found') throw e;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('CFRproxy launch was not confirmed; check the session before retrying');
}
