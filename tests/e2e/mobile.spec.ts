import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile, writeFile } from 'node:fs/promises';
async function pair(page: any) {
  const directory = (await readFile('.data/e2e-directory', 'utf8')).trim();
  try {
    const cookies = JSON.parse(await readFile(directory + '/browser-cookies', 'utf8'));
    await page.context().addCookies(cookies);
  } catch {
    /* First device in isolated fixture. */
  }
  await page.goto('/');
  await page
    .getByRole('heading', { name: 'Connect to Relay' })
    .or(page.getByRole('button', { name: 'Open sessions', exact: true }))
    .or(page.getByRole('heading', { name: 'Sessions', exact: true }))
    .first()
    .waitFor();
  if (await page.getByRole('heading', { name: 'Connect to Relay' }).isVisible()) {
    await page.getByLabel('Device name').fill('Browser test');
    await page
      .getByLabel('Pairing key', { exact: true })
      .fill((await readFile(directory + '/pairing-key', 'utf8')).trim());
    await page.getByRole('button', { name: 'Connect device' }).click();
  }
  await openSessions(page);
  await writeFile(directory + '/browser-cookies', JSON.stringify(await page.context().cookies()), {
    mode: 0o600,
  });
}

async function openSessions(page: any) {
  if ((await page.viewportSize())?.width < 768) {
    if (!(await page.getByRole('dialog', { name: 'Sessions', exact: true }).isVisible()))
      await page.getByRole('button', { name: 'Open sessions', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();
}
test('mobile chat: native approval, serial queued work, reconnect, and settings', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // A slow receipt must not erase a follow-up typed while the previous request is pending.
  await page.route('**/api/sessions/*/tasks', async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.fulfill({ response });
  });
  await pair(page);
  await page.screenshot({ path: 'docs/screenshots/inbox-mobile.png' });
  await page.getByRole('button', { name: /Atlas API/ }).click();
  await expect(page.getByRole('heading', { name: 'Atlas API', exact: true })).toBeVisible();
  await page
    .getByLabel('Instruction', { exact: true })
    .fill('Review the code and request approval');
  await page.getByLabel('Instruction behavior').selectOption('queue');
  await page.getByRole('button', { name: 'Queue instruction', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Run the project’s integration tests?' }),
  ).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/approval-mobile.png' });
  await page.getByLabel('Instruction', { exact: true }).fill('First followup');
  await page.getByLabel('Instruction behavior').selectOption('queue');
  await page.getByRole('button', { name: 'Queue instruction', exact: true }).click();
  await page.getByLabel('Instruction', { exact: true }).fill('Second followup');
  await page.getByLabel('Instruction behavior').selectOption('queue');
  await page.getByRole('button', { name: 'Queue instruction', exact: true }).click();
  await page.getByRole('button', { name: /Task queue,/ }).click();
  await expect(page.getByText('First followup', { exact: true })).toBeVisible();
  await expect(page.getByText('Second followup', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/queue-mobile.png' });
  await page.getByRole('button', { name: 'Back to sessions' }).click();
  await page.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect(
    page.getByText(
      /Instruction queued|Sent\. Your agent|Last instruction completed|Sending to your agent/,
    ),
  ).toBeVisible();
  await page.context().setOffline(true);
  await expect(page.getByText('Reconnecting. Your agent keeps running.')).toBeVisible({
    timeout: 15000,
  });
  await page.screenshot({ path: 'docs/screenshots/disconnected-mobile.png' });
  await page.context().setOffline(false);
  await expect(page.getByText('Reconnecting. Your agent keeps running.')).not.toBeVisible({
    timeout: 15000,
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Atlas API', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Task queue,/ }).click();
  await expect(page.getByText('completed', { exact: true })).toHaveCount(3, { timeout: 15000 });
  await page.getByRole('button', { name: 'Back to sessions' }).click();
  await page.screenshot({ path: 'docs/screenshots/conversation-mobile.png' });
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await openSessions(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/settings-mobile.png' });
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.screenshot({ path: 'docs/screenshots/settings-dark-mobile.png' });
  const dark = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(dark.violations).toEqual([]);
});
test('responsive inbox supports phone, landscape, tablet, desktop, zoom, and reduced motion', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await pair(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [width, height] of [
    [320, 740],
    [375, 812],
    [430, 932],
    [844, 390],
    [768, 1024],
    [1440, 1000],
  ]) {
    await page.setViewportSize({ width, height });
    await openSessions(page);
    await expect(page.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const controls = await page.locator('button:visible').evaluateAll((buttons: any[]) =>
      buttons.map((b) => ({
        label: b.getAttribute('aria-label') ?? b.textContent,
        height: b.getBoundingClientRect().height,
      })),
    );
    expect(controls.filter((b: any) => b.height < 47)).toEqual([]);
  }
  await page.screenshot({ path: 'docs/screenshots/inbox-desktop.png' });
  await page.getByRole('button', { name: /Atlas API/ }).click();
  await page.screenshot({ path: 'docs/screenshots/conversation-desktop.png' });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('mobile attachments: photo and file previews, draft recovery, removal and delivery', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.getByRole('button', { name: /Atlas API/ }).click();
  await page.getByLabel('Instruction', { exact: true }).fill('Review these attachments');
  await page.getByRole('button', { name: 'Add files or images' }).click();
  await expect(page.getByRole('button', { name: 'Camera', exact: true })).toBeVisible();
  await page.getByLabel('Choose photos').setInputFiles({
    name: 'screenshot.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jSTcAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(page.getByText(/KB · Ready/)).toHaveCount(1);
  await page.getByLabel('Choose files').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Check the layout on mobile.'),
  });
  await expect(page.getByText(/KB · Ready/)).toHaveCount(2);
  await page.screenshot({ path: 'docs/screenshots/attachments-mobile.png' });
  await page.reload();
  await expect(page.getByLabel('Instruction', { exact: true })).toHaveValue(
    'Review these attachments',
  );
  await expect(page.getByText(/KB · Ready/)).toHaveCount(2);
  await page.getByRole('button', { name: 'Remove notes.txt', exact: true }).click();
  await expect(page.getByText(/KB · Ready/)).toHaveCount(1);
  await page.getByLabel('Instruction behavior').selectOption('queue');
  await page.getByRole('button', { name: 'Queue instruction', exact: true }).click();
  await expect(page.getByLabel('Message attachments')).toHaveCount(0);
  await expect(page.getByLabel('Instruction', { exact: true })).toHaveValue('');
  const sentImage = page.locator('.sent-file > button > img');
  await expect(sentImage).toBeVisible();
  await sentImage.click();
  await expect(page.getByRole('dialog', { name: 'Preview screenshot.png' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const issues = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(issues.violations).toEqual([]);
});

test('mobile audit: dense inbox, missing chat binding, and keyboard-sized composer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  const { sessions } = await page.evaluate(async () => (await fetch('/api/sessions')).json());
  const baseline = sessions[0];
  const items = Array.from({ length: 20 }, (_, index) => ({
    ...baseline,
    id: `audit-${index}`,
    sessionName: `Project ${index + 1}: review authentication and file uploads`,
    cwd: `/home/developer/projects/long-project-${index + 1}/src`,
    harness: index % 2 ? 'claude' : 'codex',
    capabilities: index === 0 ? {} : baseline.capabilities,
    status: index === 0 ? 'working' : 'idle',
    preview: index === 0 ? '' : 'The changes are ready for review.',
    diagnostic:
      index === 0 ? 'Herdr has not reported a native session identity yet.' : baseline.diagnostic,
  }));
  await page.route('**/api/sessions', (route) => route.fulfill({ json: { sessions: items } }));
  await page.route('**/api/sessions/audit-*', (route) =>
    route.fulfill({ json: { session: items[0], interactions: [], tasks: [] } }),
  );
  await page.route('**/api/sessions/audit-*/events?*', (route) =>
    route.fulfill({ json: { events: [] } }),
  );
  await page.routeWebSocket('**/ws', (socket) =>
    socket.send(JSON.stringify({ type: 'invalidate', sessions: items })),
  );
  await page.goto('/');
  await openSessions(page);
  await page.getByLabel('Filter by agent').selectOption('codex');
  await expect(page.locator('.inbox-heading .count')).toHaveText('10');
  await page.screenshot({ path: 'docs/screenshots/inbox-dense-mobile.png' });
  await page.getByRole('button', { name: /Project 1:/ }).click();
  await expect(page.getByRole('heading', { name: 'Chat is not connected' })).toBeVisible();
  await expect(page.getByText('Ready for your next instruction')).toHaveCount(0);
  await page.screenshot({ path: 'docs/screenshots/unbound-mobile.png' });
  await openSessions(page);
  await page.getByRole('button', { name: /Project 3:/ }).click();
  await page.setViewportSize({ width: 390, height: 410 });
  await page
    .getByLabel('Instruction', { exact: true })
    .fill('A draft with the software keyboard open');
  const bounds = await page
    .getByRole('button', { name: 'Send message', exact: true })
    .boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(410);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/keyboard-sized-mobile.png' });
});

test('live chat appends events without refetching history and preserves reading position and drafts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  const { sessions } = await page.evaluate(async () => (await fetch('/api/sessions')).json());
  const session = {
    ...sessions[0],
    status: 'working',
    model: 'gpt-6-astra',
    sessionName: 'Streaming acceptance',
  };
  const events = Array.from({ length: 30 }, (_, index) => ({
    id: `stream-${index}`,
    sourceId: `native-${index}`,
    sequence: index + 1,
    sessionId: session.id,
    nativeSessionId: session.nativeSessionId,
    source: 'mock',
    kind: index % 2 ? 'assistant.message' : 'user.message',
    timestamp: new Date().toISOString(),
    data: {
      text:
        `Conversation message ${index}: ` +
        'A useful discussion of the requested change. '.repeat(5),
    },
  }));
  let historyRequests = 0;
  let stream: any;
  await page.route('**/api/sessions', (route) => route.fulfill({ json: { sessions: [session] } }));
  await page.route(`**/api/sessions/${session.id}`, (route) =>
    route.fulfill({ json: { session, tasks: [], interactions: [] } }),
  );
  await page.route('**/events?*', (route) => {
    historyRequests++;
    return route.fulfill({ json: { events } });
  });
  await page.routeWebSocket('**/ws', (socket) => {
    stream = socket;
    socket.send(JSON.stringify({ type: 'invalidate', sessions: [session] }));
  });
  await page.reload();
  await openSessions(page);
  await page.getByRole('button', { name: /Streaming acceptance/ }).click();
  await expect(page.locator('.conversation-heading .session-model')).toHaveText('gpt-6-astra');
  await expect(page.getByRole('status', { name: /is working/ })).toBeAttached();
  const composer = page.getByLabel('Instruction', { exact: true });
  await composer.fill('Keep this draft while messages arrive');
  await page.locator('.conversation-scroll').evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(page.getByRole('button', { name: 'Latest messages', exact: true })).toBeVisible();
  const initialRequests = historyRequests;
  for (let n = 0; n < 3; n++) {
    stream.send(
      JSON.stringify({
        type: 'event',
        event: {
          ...events[0],
          id: `delta-${n}`,
          sequence: 31 + n,
          kind: 'assistant.delta',
          data: { itemId: 'new-reply', text: ['Hello ', 'from ', 'the live stream.'][n] },
        },
      }),
    );
    stream.send(JSON.stringify({ type: 'invalidate', sessions: [session] }));
  }
  await expect(composer).toHaveValue('Keep this draft while messages arrive');
  await expect(composer).toBeFocused();
  await expect
    .poll(() => page.locator('.conversation-scroll').evaluate((element) => element.scrollTop))
    .toBeLessThan(10);
  await page.getByRole('button', { name: 'Latest messages', exact: true }).click();
  await expect(page.getByText('Hello from the live stream.', { exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: /is working/ })).toBeVisible();
  expect(historyRequests).toBe(initialRequests);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.working-dots i').first()).toHaveCSS('animation-name', 'none');
  await page.screenshot({ path: 'docs/screenshots/working-mobile.png' });
  stream.send(JSON.stringify({ type: 'invalidate', sessions: [{ ...session, status: 'idle' }] }));
  await expect(page.getByRole('status', { name: /is working/ })).toHaveCount(0);
});

test('new session chooses Fred folder, agent and custom CFRproxy model; launch receipt survives reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.route('**/api/launch/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [
          {
            id: 'codex-cfr',
            hostId: 'fred',
            harness: 'codex',
            provider: 'CFRproxy',
            label: 'Codex',
            connected: true,
            models: [{ id: 'fred/model', name: 'Fred model' }],
            allowCustomModel: true,
          },
        ],
      },
    }),
  );
  await page.route('**/api/launch/folders?*', (route) =>
    route.fulfill({
      json: { path: '/home/developer/projects', parent: null, directories: [], truncated: false },
    }),
  );
  let body: any;
  await page.route('**/api/launch', async (route) => {
    body = route.request().postDataJSON();
    await route.fulfill({
      json: {
        requestId: body.requestId,
        hostId: 'fred',
        terminalId: 'new-term',
        status: 'started',
      },
    });
  });
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await page.getByRole('button', { name: /Choose a folder/ }).click();
  await page.getByRole('button', { name: 'Use this folder' }).click();
  await page.getByRole('combobox', { name: 'Model', exact: true }).selectOption('__custom');
  await page.getByLabel('Custom model ID').fill('fred/qwen38-27b');
  await page.getByLabel('Session name').fill('Mobile code review');
  await page.getByLabel('First message').fill('Review mobile layout');
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.locator('.new-session-scroll').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: 'docs/screenshots/new-session-mobile.png' });
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await expect(page.getByText('Agent started. Connecting its conversation…')).toBeVisible();
  expect(body.cwd).toBe('/home/developer/projects');
  expect(body.profileId).toBe('codex-cfr');
  expect(body.model).toBe('fred/qwen38-27b');
  await page.route('**/api/launch/*', (route) =>
    route.request().url().endsWith(body.requestId)
      ? route.fulfill({ json: { requestId: body.requestId, hostId: 'fred', status: 'started' } })
      : route.fallback(),
  );
  await page.reload();
  await expect(page.getByText('Agent started. Connecting its conversation…')).toBeVisible();
});

test('mobile opens chat first, defaults to Send, and supports edge swipe drawer without losing draft', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.getByRole('button', { name: /Atlas API/ }).click();
  await expect(page.getByLabel('Instruction behavior')).toHaveValue('auto');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
  await page.getByLabel('Instruction', { exact: true }).fill('A draft survives navigation');
  const touch = await page.context().newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 12, y: 260 }],
  });
  for (const x of [24, 48, 90, 150, 220])
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: 260 }],
    });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByRole('dialog', { name: 'Sessions', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close sessions' })).toBeFocused();
  await expect.poll(async () => (await page.locator('#session-drawer').boundingBox())?.x).toBe(0);
  await page.screenshot({ path: 'docs/screenshots/swipe-drawer-mobile.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Instruction', { exact: true })).toHaveValue(
    'A draft survives navigation',
  );
  await page.reload();
  await expect(page.getByLabel('Instruction', { exact: true })).toHaveValue(
    'A draft survives navigation',
  );
  await expect(page.getByRole('dialog', { name: 'Sessions', exact: true })).not.toBeVisible();
});

test('default Send and Steer use native message delivery; only explicit Queue schedules work', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.getByRole('button', { name: /Atlas API/ }).click();
  const draft = page.getByLabel('Instruction', { exact: true });
  let queueRequests = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/tasks')) queueRequests++;
  });
  await draft.fill('Keep working for steering UI test');
  const sent = page.waitForResponse(
    (response) => response.url().endsWith('/messages') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  expect((await (await sent).json()).mode).toBe('send');
  await expect(page.getByRole('button', { name: 'Steer active turn', exact: true })).toBeVisible();
  await draft.fill('Change the current approach');
  const steered = page.waitForResponse(
    (response) => response.url().endsWith('/messages') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Steer active turn', exact: true }).click();
  expect((await (await steered).json()).mode).toBe('steer');
  expect(queueRequests).toBe(0);
  await draft.fill('Explicit later turn');
  await page.getByLabel('Instruction behavior').selectOption('queue');
  const queued = page.waitForResponse(
    (response) => response.url().endsWith('/tasks') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Queue instruction', exact: true }).click();
  const queuedResponse = await queued;
  const body = await queuedResponse.json();
  expect(body.task.status).toBe('pending');
  expect(queueRequests).toBe(1);
  await page.evaluate(async (sessionId) => {
    await fetch(`/api/sessions/${sessionId}/interrupt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-RC-Request': '1' },
      body: JSON.stringify({ confirm: true }),
    });
  }, body.task.sessionId);
  await expect
    .poll(async () =>
      page.evaluate(async ({ sessionId, id }) => {
        const detail = await (await fetch(`/api/sessions/${sessionId}`)).json();
        return detail.tasks.find((task: any) => task.id === id)?.status;
      }, body.task),
    )
    .toBe('completed');
});

test('Steer renders immediately, preserves the next draft, and keeps uncertain delivery visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.getByRole('button', { name: /Atlas API/ }).click();
  // Keep a mock turn working while testing slow and interrupted delivery feedback.
  await page.getByLabel('Instruction', { exact: true }).fill('Keep working for steering UI test');
  await page.getByLabel('Instruction behavior').selectOption('queue');
  await page.getByRole('button', { name: 'Queue instruction', exact: true }).click();
  await page.getByLabel('Instruction behavior').selectOption('auto');
  await expect(page.getByRole('button', { name: 'Steer active turn', exact: true })).toBeVisible();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/sessions/*/messages', async (route) => {
    await held;
    await route.fulfill({ json: { mode: 'steer' } });
  });
  const draft = page.getByLabel('Instruction', { exact: true });
  await draft.fill('Focus on the mobile navigation');
  await page.getByRole('button', { name: 'Steer active turn', exact: true }).click();
  await expect(page.locator('.outgoing-message')).toContainText('Focus on the mobile navigation');
  await expect(page.locator('.outgoing-message')).toContainText('Sending…');
  await expect(draft).toHaveValue('');
  await expect(draft).toBeFocused();
  await page.screenshot({ path: 'docs/screenshots/steer-sending-mobile.png' });
  await draft.fill('Next instruction stays here');
  release();
  await expect(page.locator('.outgoing-message')).toContainText('Sent');
  await expect(draft).toHaveValue('Next instruction stays here');
  await page.unroute('**/api/sessions/*/messages');
  await page.route('**/api/sessions/*/messages', (route) => route.abort());
  await page.getByRole('button', { name: 'Steer active turn', exact: true }).click();
  await expect(page.locator('.outgoing-message').last()).toContainText('Delivery not confirmed');
  await expect(page.locator('.outgoing-message').last()).toContainText(
    'Next instruction stays here',
  );
  await page.reload();
  await expect(page.locator('.outgoing-message').last()).toContainText('Delivery not confirmed');
});

test('native question replies read like chat and repeated real touch taps reliably open controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await pair(page);
  const { sessions } = await page.evaluate(async () => (await fetch('/api/sessions')).json());
  const session = sessions.find((s: any) => s.project === 'Atlas API') ?? sessions[0];
  const text =
    '<send_user_message_question_reply>\n' +
    JSON.stringify([
      {
        questionItemId: 'native-request',
        question: 'Which session is still queuing?',
        answer: 'this one lol',
      },
    ]) +
    '\n</send_user_message_question_reply>';
  await page.route('**/events?*', (route) =>
    route.fulfill({
      json: {
        events: [
          {
            id: 'question-reply',
            sourceId: 'native-reply',
            sequence: 9999999,
            sessionId: session.id,
            nativeSessionId: session.nativeSessionId,
            source: 'codex',
            kind: 'user.message',
            timestamp: new Date().toISOString(),
            data: { text },
          },
        ],
      },
    }),
  );
  await page.reload();
  await openSessions(page);
  await page.getByRole('button', { name: /Atlas API/ }).click();
  await expect(page.getByText('this one lol', { exact: true })).toBeVisible();
  await expect(page.getByText('Which session is still queuing?', { exact: true })).toBeVisible();
  await expect(page.getByText(/<send_user_message_question_reply>/)).toHaveCount(0);
  const touch = await page.context().newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const tap = async (label: string) => {
    const button = page.getByRole('button', { name: label, exact: true });
    await button.scrollIntoViewIfNeeded();
    const box = (await button.boundingBox())!;
    const x = box.x + 5,
      y = box.y + box.height / 2;
    // Hit near the left of the target and introduce realistic finger jitter.
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + 3, y: y + 2 }],
    });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  for (let i = 0; i < 5; i++) {
    await tap('Open sessions');
    await expect(page.getByRole('dialog', { name: 'Sessions', exact: true })).toBeVisible();
    await tap('Close sessions');
    await expect(page.getByRole('dialog', { name: 'Sessions', exact: true })).not.toBeVisible();
  }
  await tap('Copy message');
  await expect(page.getByText('Copied', { exact: true })).toBeVisible();
  await page.getByLabel('Instruction behavior').selectOption('queue');
  await tap('Add files or images');
  await expect(page.getByRole('button', { name: 'Camera', exact: true })).toBeVisible();
  await tap('Add files or images');
  await page.getByLabel('Instruction behavior').selectOption('auto');
  await page.getByLabel('Instruction', { exact: true }).fill('Refine the mobile layout');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'docs/screenshots/conversation-refined-dark-mobile.png' });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: 'docs/screenshots/conversation-refined-light-mobile.png' });
  const issues = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(issues.violations).toEqual([]);
});
