#!/usr/bin/env python3
"""Report native Codex hook identity to Herdr, without reading terminal output.

Add beside existing hooks. Never modifies process ownership, starts a session,
or sends a turn. Linux process ancestry prevents subagents replacing a pane owner.
"""
import json
import os
import re
import socket
import sys
import time


def request(socket_path, method, params):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(1)
        client.connect(socket_path)
        client.sendall((json.dumps({'id': 'relay-codex-session', 'method': method, 'params': params}) + '\n').encode())
        data = b''
        while b'\n' not in data:
            chunk = client.recv(65536)
            if not chunk or len(data) > 1024 * 1024:
                raise ValueError('Invalid Herdr response')
            data += chunk
        value = json.loads(data.split(b'\n')[0])
        if value.get('error'):
            raise ValueError('Herdr rejected request')
        return value.get('result', value)


def ancestors():
    result = set()
    pid = os.getpid()
    while pid > 1 and pid not in result:
        result.add(pid)
        with open(f'/proc/{pid}/stat', encoding='utf-8') as handle:
            pid = int(handle.read().rsplit(') ', 1)[1].split()[1])
    return result


def report(payload):
    pane = os.environ.get('HERDR_PANE_ID')
    sock = os.environ.get('HERDR_SOCKET_PATH')
    native = payload.get('session_id')
    event = payload.get('hook_event_name')
    if not pane or not sock or event not in ('SessionStart', 'UserPromptSubmit', 'Stop', 'Interrupt'):
        return
    if not isinstance(native, str) or not re.fullmatch(r'[a-fA-F0-9-]{36}', native):
        return
    inherited = os.environ.get('CODEX_THREAD_ID')
    if inherited and inherited != native:
        return
    agent = request(sock, 'agent.get', {'target': pane})['agent']
    if agent.get('agent') != 'codex':
        return
    info = request(sock, 'pane.process_info', {'pane_id': pane})['process_info']
    owner = info.get('foreground_process_group_id')
    if owner not in ancestors():
        return
    if not any(p.get('pid') == owner and p.get('name') == 'codex' for p in info.get('foreground_processes', [])):
        return
    existing = agent.get('agent_session')
    if existing and existing.get('value') != native and event != 'SessionStart':
        return
    # Recheck the concrete terminal immediately before registration.
    latest = request(sock, 'agent.get', {'target': pane})['agent']
    if latest.get('terminal_id') != agent.get('terminal_id'):
        return
    request(sock, 'pane.report_agent_session', {
        'pane_id': pane, 'source': 'herdr:codex', 'agent': 'codex',
        'agent_session_id': native, 'seq': time.time_ns(),
    })


if __name__ == '__main__':
    try:
        report(json.loads(sys.stdin.buffer.read(256 * 1024)))
    except Exception:
        # Discovery must never block, approve or interrupt the native agent.
        pass
