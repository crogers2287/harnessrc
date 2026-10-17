import type { HerdrClient } from '../../../packages/herdr/src/index.ts';

/** Only the selected project's bootstrap prompt, after an authorized launch/restart. */
export function isClaudeFolderTrust(visible: string, recent: string, cwd: string) {
  const compact = (value: string) => value.replace(/\s/g, '');
  const screen = compact(visible),
    history = compact(recent);
  return (
    screen.includes('❯No,exit') &&
    screen.includes('Yes,Itrustthisfold') &&
    screen.includes('Entertoconfirm') &&
    history.includes(`Accessingworkspace:${compact(cwd)}`) &&
    history.includes('Isthisaprojectyoucreatedoroneyoutrust?')
  );
}
export async function acceptClaudeResumeTrust(
  client: HerdrClient,
  pane: string,
  terminal: string,
  name: string,
  cwd: string,
) {
  const { agent } = await client.request('agent.get', { target: pane });
  if (
    agent.terminal_id !== terminal ||
    agent.name !== name ||
    agent.agent !== 'claude' ||
    (agent.foreground_cwd ?? agent.cwd) !== cwd ||
    agent.agent_session
  )
    return false;
  const { process_info: owner } = await client.request('pane.process_info', { pane_id: pane });
  if (!owner.foreground_process_group_id || owner.foreground_process_group_id === owner.shell_pid)
    return false;
  const { read: visible } = await client.request('pane.read', { pane_id: pane, source: 'visible' });
  const { read: recent } = await client.request('pane.read', {
    pane_id: pane,
    source: 'recent_unwrapped',
    lines: 150,
  });
  if (!isClaudeFolderTrust(visible.text, recent.text, cwd)) return false;
  const fresh = await client.request('agent.get', { target: pane });
  if (
    fresh.agent.terminal_id !== terminal ||
    fresh.agent.name !== name ||
    fresh.agent.agent_session
  )
    return false;
  const { process_info: current } = await client.request('pane.process_info', { pane_id: pane });
  if (
    current.shell_pid !== owner.shell_pid ||
    current.foreground_process_group_id !== owner.foreground_process_group_id
  )
    return false;
  // Herdr owns input delivery; no shell commands or arbitrary approvals are generated.
  await client.request('agent.send_keys', { target: pane, keys: ['down', 'enter'] });
  return true;
}
