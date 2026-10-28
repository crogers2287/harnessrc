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
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
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
  await page.getByRole('button', { name: 'Agent tasks', exact: true }).click();
  await page.getByText('Queued messages', { exact: true }).click();
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
  await page.getByRole('button', { name: 'Agent tasks', exact: true }).click();
  await page.getByText('Queued messages', { exact: true }).click();
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
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
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
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
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
  await expect(page.getByLabel('Instruction', { exact: true })).toHaveText(
    'Review these attachments',
  );
  await expect(page.getByText(/KB · Ready/)).toHaveCount(2);
  await page.getByRole('button', { name: 'Remove notes.txt', exact: true }).click();
  await expect(page.getByText(/KB · Ready/)).toHaveCount(1);
  await page.getByLabel('Instruction behavior').selectOption('queue');
  await page.getByRole('button', { name: 'Queue instruction', exact: true }).click();
  await expect(page.getByLabel('Message attachments')).toHaveCount(0);
  await expect(page.getByLabel('Instruction', { exact: true })).toHaveText('');
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
  await page.getByRole('button', { name: /^Codex, 10 sessions$/ }).click();
  await expect(page.locator('.inbox-heading .count')).toHaveText('10');
  await page.screenshot({ path: 'docs/screenshots/inbox-dense-mobile.png' });
  await page.locator('button.session-row').filter({ hasText: 'Project 1:' }).click();
  await expect(page.getByRole('heading', { name: 'Chat is not connected' })).toBeVisible();
  await expect(page.getByText('Ready for your next instruction')).toHaveCount(0);
  await page.screenshot({ path: 'docs/screenshots/unbound-mobile.png' });
  await openSessions(page);
  await page.locator('button.session-row').filter({ hasText: 'Project 3:' }).click();
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
  await page.locator('button.session-row').filter({ hasText: 'Streaming acceptance' }).click();
  await expect(page.locator('.conversation-heading .header-model')).toContainText('gpt-6-astra');
  await expect(page.getByRole('status', { name: /is working/ })).toBeAttached();
  const composer = page.getByLabel('Instruction', { exact: true });
  await composer.fill('Keep this draft while messages arrive');
  await page.locator('.conversation-scroll').evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(page.getByRole('button', { name: 'Latest messages', exact: true })).toBeVisible();
  // Small upward scrolls must also stop following; the old 100px threshold re-pinned them.
  const pane = page.locator('.conversation-scroll');
  await pane.evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight - 50;
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true }));
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(page.getByRole('button', { name: 'Latest messages', exact: true })).toBeVisible();
  await pane.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  // A layout-induced visit to the bottom must not undo reader intent.
  await pane.evaluate((element) => {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(page.getByRole('button', { name: 'Latest messages', exact: true })).toBeVisible();
  await pane.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
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
  await expect(composer).toHaveText('Keep this draft while messages arrive');
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
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
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
  await expect(page.getByLabel('Instruction', { exact: true })).toHaveText(
    'A draft survives navigation',
  );
  await page.reload();
  await expect(page.getByLabel('Instruction', { exact: true })).toHaveText(
    'A draft survives navigation',
  );
  await expect(page.getByRole('dialog', { name: 'Sessions', exact: true })).not.toBeVisible();
});

test('default Send and Steer use native message delivery; only explicit Queue schedules work', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
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
  await expect(page.getByRole('button', { name: 'Stop turn', exact: true })).toBeVisible();
  await draft.fill('Change the current approach');
  await expect(page.getByRole('button', { name: 'Steer active turn', exact: true })).toBeVisible();
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
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
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
  await expect(draft).toHaveText('');
  await expect(draft).toBeFocused();
  await page.screenshot({ path: 'docs/screenshots/steer-sending-mobile.png' });
  await draft.fill('Next instruction stays here');
  release();
  await expect(page.locator('.outgoing-message')).toContainText('Delivered');
  await expect(draft).toHaveText('Next instruction stays here');
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
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
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
  await tap('Show session information');
  await expect(page.getByRole('heading', { name: 'Session command center' })).toBeVisible();
  await tap('Back to sessions');
  await expect(page.getByRole('heading', { name: 'Session command center' })).not.toBeVisible();
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

test('mobile browser Back opens sessions from chat and preserves secondary navigation and drafts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  await page.getByLabel('Instruction', { exact: true }).fill('Keep this draft when I go back');
  await page.reload();
  await page.getByLabel('Instruction', { exact: true }).waitFor();
  await page.goBack();
  await expect(page.getByRole('dialog', { name: 'Sessions', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close sessions', exact: true }).click();
  await expect(page.getByLabel('Instruction', { exact: true })).toHaveText(
    'Keep this draft when I go back',
  );
  await page.getByRole('button', { name: 'Session details', exact: true }).click();
  await page.goBack();
  await expect(page.getByRole('dialog', { name: 'Sessions', exact: true })).not.toBeVisible();
  await expect(page.getByLabel('Instruction', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog', { name: 'Sessions', exact: true })).toBeVisible();
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  await page.getByRole('button', { name: 'Open sessions', exact: true }).click();
  await page.goBack();
  await expect(page.getByRole('dialog', { name: 'Sessions', exact: true })).not.toBeVisible();
});

test('working composer accepts file and image steering through real touch targets with a reduced keyboard viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 520 });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  const draft = page.getByLabel('Instruction', { exact: true });
  // Earlier interaction tests leave this mock working; create a turn if run independently.
  if (await page.getByRole('button', { name: 'Send message', exact: true }).isVisible()) {
    await draft.fill('Keep working for steering UI test');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'Steer active turn', exact: true })).toBeVisible();
  const touch = await page.context().newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const tap = async (name: string) => {
    const button = page.getByRole('button', { name, exact: true });
    const b = (await button.boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(48);
    const x = b.x + b.width / 2,
      y = b.y + b.height / 2;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  for (let i = 0; i < 4; i++) {
    await draft.focus();
    await tap('Add files or images');
    await expect(page.getByRole('button', { name: 'Files', exact: true })).toBeVisible();
    await tap('Add files or images');
  }
  await tap('Add files or images');
  await page.screenshot({ path: 'docs/screenshots/attach-keyboard-mobile.png' });
  const chooser = page.waitForEvent('filechooser');
  await tap('Files');
  await (
    await chooser
  ).setFiles({
    name: 'steer-note.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('STEER_UPLOAD_PROOF'),
  });
  await expect(page.getByText(/KB · Ready/)).toBeVisible();
  await tap('Add files or images');
  const photos = page.waitForEvent('filechooser');
  await tap('Photos');
  await (
    await photos
  ).setFiles({
    name: 'steer-image.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(page.getByText(/KB · Ready/)).toHaveCount(2);
  await draft.fill('Use these attachments in the active turn');
  const button = page.getByRole('button', { name: 'Steer active turn', exact: true });
  const b = (await button.boundingBox())!,
    icon = (await button.locator('svg').boundingBox())!;
  expect(Math.abs(b.x + b.width / 2 - (icon.x + icon.width / 2))).toBeLessThan(1);
  expect(Math.abs(b.y + b.height / 2 - (icon.y + icon.height / 2))).toBeLessThan(1);
  await page.screenshot({ path: 'docs/screenshots/steer-attachments-mobile.png' });
  let queued = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/tasks')) queued++;
  });
  const sent = page.waitForResponse(
    (r) => r.url().endsWith('/messages') && r.request().method() === 'POST',
  );
  await tap('Steer active turn');
  const response = await sent;
  expect(response.ok()).toBe(true);
  expect((await response.json()).mode).toBe('steer');
  expect(response.request().postDataJSON().attachments).toHaveLength(2);
  expect(queued).toBe(0);
  await expect(page.locator('.outgoing-message').last()).toContainText('steer-note.txt');
  await expect(draft).toHaveText('');
});

test('saved attachment bubble disappears when native history arrives and stays gone after reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  const { sessions } = await page.evaluate(async () => (await fetch('/api/sessions')).json());
  const s = sessions[0];
  const now = new Date().toISOString();
  await page.evaluate(
    ({ id, now }) =>
      sessionStorage.setItem(
        `relay-outgoing:${id}`,
        JSON.stringify([
          {
            key: 'browser-key',
            prompt: 'Check this screenshot',
            attachments: [{ id: 'saved-photo', name: 'screen.png', mime: 'image/png' }],
            started: now,
            state: 'confirmed',
          },
        ]),
      ),
    { id: s.id, now },
  );
  await page.route('**/events?*', (r) =>
    r.fulfill({
      json: {
        events: [
          {
            id: 'native-photo',
            sourceId: 'native-photo',
            sequence: 999999,
            sessionId: s.id,
            nativeSessionId: s.nativeSessionId,
            source: s.harness,
            kind: 'user.message',
            timestamp: now,
            data: {
              taskId: 'different-native-task',
              text: 'Check this screenshot',
              attachments: [{ id: 'saved-photo', name: 'screen.png', mime: 'image/png' }],
            },
          },
        ],
      },
    }),
  );
  await page.evaluate((id) => {
    const key = `relay-outgoing:${id}`;
    const items = JSON.parse(sessionStorage.getItem(key)!);
    items.push({
      ...items[0],
      key: crypto.randomUUID(),
      prompt: 'Old card outside this history page',
    });
    sessionStorage.setItem(key, JSON.stringify(items));
  }, s.id);
  await page.route('**/message-receipts/*', (r) => r.fulfill({ json: { nativeSeen: true } }));
  await page.goto('/?session=' + s.id);
  await expect(page.getByText('Check this screenshot', { exact: true })).toHaveCount(1);
  await expect(page.locator('.outgoing-message')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Check this screenshot', { exact: true })).toHaveCount(1);
  await expect(page.locator('.outgoing-message')).toHaveCount(0);
});

test('DSH drawer separates saved history, combines filters, resets and preserves selection', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  const { sessions } = await page.evaluate(async () => (await fetch('/api/sessions')).json());
  const s = sessions[0];
  const items = [
    {
      ...s,
      id: 'filter-live',
      harness: 'dsh',
      presence: 'live',
      status: 'working',
      sessionName: 'DSH live API',
      cwd: '/projects/api',
      model: 'gpt-6-astra',
    },
    {
      ...s,
      id: 'filter-saved',
      harness: 'dsh',
      presence: 'saved',
      status: 'idle',
      sessionName: 'DSH saved website',
      cwd: '/projects/web',
    },
    {
      ...s,
      id: 'filter-codex',
      harness: 'codex',
      presence: 'live',
      status: 'idle',
      sessionName: 'Codex API',
    },
  ];
  await page.route('**/api/sessions', (r) => r.fulfill({ json: { sessions: items } }));
  await page.routeWebSocket('**/ws', (socket) =>
    socket.send(JSON.stringify({ type: 'invalidate', sessions: items })),
  );
  await page.goto('/');
  await openSessions(page);
  await page.getByRole('button', { name: 'DSH, 1 sessions', exact: true }).click();
  await expect(page.locator('.session-row')).toHaveCount(1);
  await expect(page.locator('.session-row')).toContainText('DSH live API');
  await page.getByRole('button', { name: /^History/ }).click();
  await expect(page.locator('.session-row')).toHaveCount(1);
  await expect(page.locator('.session-row')).toContainText('DSH saved website');
  await expect(page.locator('.session-row')).toContainText('Saved session');
  await expect(page.locator('.session-row .unread')).toHaveCount(0);
  await page.getByRole('button', { name: /^Live/ }).click();
  await page.getByRole('button', { name: /^DSH,/ }).click();
  await page.getByLabel('Search sessions').fill('astra api');
  await page.getByText('Filters', { exact: true }).click();
  await page.getByLabel('Filter by status').selectOption('working');
  await page.getByLabel('Filter by directory').selectOption('/projects/api');
  await expect(page.locator('.session-row')).toHaveCount(1);
  await page.getByText('Filters (2)', { exact: true }).click();
  await page.screenshot({ path: 'docs/screenshots/session-filters-mobile.png' });
  await page.reload();
  await openSessions(page);
  await expect(page.getByRole('button', { name: /^DSH,/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Clear session filters' }).click();
  await expect(page.locator('.session-row')).toHaveCount(2);
  await expect(page.getByLabel('Search sessions')).toHaveValue('');
  const a = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(a.violations).toEqual([]);
});

test('composer tracks a shrinking and panning Android visual viewport without a window resize', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), {
      height: 844,
      width: 390,
      offsetTop: 0,
      offsetLeft: 0,
      scale: 1,
    });
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
  });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  await page.getByLabel('Instruction', { exact: true }).fill('Keep this draft above the keyboard');
  for (const [height, top] of [
    [500, 0],
    [380, 65],
    [410, 30],
  ]) {
    await page.evaluate(
      ({ height, top }) => {
        Object.assign(window.visualViewport!, { height, offsetTop: top });
        window.visualViewport!.dispatchEvent(new Event('resize'));
        window.visualViewport!.dispatchEvent(new Event('scroll'));
      },
      { height, top },
    );
    await expect
      .poll(async () => {
        const r = await page.locator('.composer').boundingBox();
        return Math.round(r!.y + r!.height);
      })
      .toBeLessThanOrEqual(height + top);
    const b = await page.locator('.send-button').boundingBox();
    expect(b!.y).toBeGreaterThan(top);
    await expect(page.locator('.conversation-header')).toBeHidden();
    await expect(page.locator('.chat-context-strip')).toBeHidden();
    await expect(page.getByLabel('Instruction', { exact: true })).toHaveText(
      'Keep this draft above the keyboard',
    );
  }
  await page.screenshot({ path: 'docs/screenshots/visual-viewport-keyboard.png' });
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { height: 844, offsetTop: 0 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect
    .poll(async () => Math.round((await page.locator('.app').boundingBox())!.height))
    .toBe(844);
  await expect(page.locator('.conversation-header')).toBeVisible();
  await expect(page.locator('.chat-context-strip')).toBeVisible();
});

test('Settings offers install help, invokes a captured native installer once, and observes installation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.getByRole('button', { name: 'How to install Relay', exact: true }).click();
  await expect(page.locator('.install-instructions')).toBeVisible();
  await page.evaluate(() => {
    (window as any).installCalls = 0;
    const e = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(e, {
      prompt: async () => {
        (window as any).installCalls++;
        return { outcome: 'accepted' };
      },
    });
    window.dispatchEvent(e);
  });
  await page.getByRole('button', { name: 'Install Relay', exact: true }).click();
  await expect(
    page.getByText('Installation accepted. Your browser will finish adding Relay.'),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).installCalls)).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.getByText('Relay is installed on this device.')).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/install-app-mobile.png' });
});

test('DSH is selectable without discovering a separate host and launches the chosen model', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.route('**/api/launch/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [
          {
            id: 'codex',
            hostId: 'fred',
            harness: 'codex',
            provider: 'Account',
            connected: true,
            models: [],
            allowCustomModel: false,
          },
          {
            id: 'dsh-cfrproxy',
            defaultAgentPreset: 'standard',
            agentPresets: [
              { id: 'standard', name: 'standard', unavailable: false },
              { id: 'haxor', name: 'haxor', unavailable: false },
              { id: 'ash', name: 'ash', unavailable: false },
              { id: 'minimal', name: 'minimal', unavailable: false },
              { id: 'broken', name: 'broken', unavailable: true },
            ],
            hostId: 'fred-dsh',
            harness: 'dsh',
            provider: 'CFRproxy',
            connected: true,
            models: [
              { id: 'codex/gpt-6.1-sol', name: 'Sol' },
              { id: 'gpt-6-astra', name: 'Astra' },
            ],
            allowCustomModel: false,
          },
        ],
      },
    }),
  );
  await page.route('**/api/launch/folders?*', async (route) => {
    expect(new URL(route.request().url()).searchParams.get('profileId')).toBe('dsh-cfrproxy');
    await route.fulfill({
      json: { path: '/home/developer/project', parent: null, directories: [], truncated: false },
    });
  });
  let launched: any;
  await page.route('**/api/launch', async (route) => {
    launched = route.request().postDataJSON();
    await route.fulfill({
      json: {
        requestId: launched.requestId,
        status: 'started',
        hostId: 'fred-dsh',
        terminalId: 'dsh:new',
      },
    });
  });
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await page.getByRole('combobox', { name: 'Agent', exact: true }).selectOption('dsh');
  await page.getByLabel('DSH agent', { exact: true }).selectOption('haxor');
  await expect(
    page.getByRole('option', { name: 'broken (unavailable)', exact: true }),
  ).toHaveJSProperty('disabled', true);
  await page.reload();
  await expect(page.getByLabel('DSH agent', { exact: true })).toHaveValue('haxor');
  await expect(page.getByRole('combobox', { name: 'Provider', exact: true })).toContainText(
    'CFRproxy',
  );
  await page.getByRole('button', { name: 'Choose a folder on fred-dsh' }).click();
  await page.getByRole('button', { name: 'Use this folder' }).click();
  await page.getByLabel('Model', { exact: true }).selectOption('gpt-6-astra');
  await page.getByLabel('First message').fill('Review the mobile interface');
  await page.locator('.new-session-scroll').evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({ path: 'docs/screenshots/dsh-launch-mobile.png' });
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await expect(page.getByText('Agent started. Connecting its conversation…')).toBeVisible();
  expect(launched).toMatchObject({
    profileId: 'dsh-cfrproxy',
    agentPreset: 'haxor',
    cwd: '/home/developer/project',
    model: 'gpt-6-astra',
    prompt: 'Review the mobile interface',
  });
});

test('clipboard screenshot uploads once, keeps draft text, and sends the attachment', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 20;
    canvas.height = 20;
    canvas.getContext('2d')!.fillRect(0, 0, 20, 20);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png'),
    );
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  });
  await page.getByLabel('Instruction', { exact: true }).fill('Look at this screenshot');
  await expect(page.getByRole('group', { name: 'Attachment options' })).toHaveCount(0);
  await page.screenshot({ path: 'docs/screenshots/clipboard-menu-mobile.png' });
  await page.getByRole('button', { name: 'Paste screenshot', exact: true }).click();
  await expect(page.getByText(/KB · Ready/)).toHaveCount(1);
  await expect(page.getByLabel('Instruction', { exact: true })).toHaveText(
    'Look at this screenshot',
  );
  await expect(page.getByRole('img', { name: /Preview of Screenshot-/ })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/clipboard-preview-mobile.png' });
  // Rich editing is required for Android IME images, but Chrome also gates media insertion.
  await expect(page.getByLabel('Instruction', { exact: true })).toHaveAttribute(
    'contenteditable',
    'true',
  );
  // The normal browser paste gesture shares this upload path as well.
  await page.getByLabel('Instruction', { exact: true }).focus();
  await page.keyboard.press('Control+v');
  await expect(page.getByText(/KB · Ready/)).toHaveCount(2);
  await page.getByLabel('Instruction behavior').selectOption('queue');
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/tasks') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Queue instruction', exact: true }).click();
  expect((await response).request().postDataJSON().attachments).toHaveLength(2);
  await expect(page.getByLabel('Message attachments')).toHaveCount(0);
});

test('clipboard denial or no image gives a usable photo fallback without losing the draft', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  await page.getByLabel('Instruction', { exact: true }).fill('Preserve me');
  await page.evaluate(() =>
    Object.defineProperty(navigator.clipboard, 'read', {
      configurable: true,
      value: async () => {
        throw new DOMException('Denied', 'NotAllowedError');
      },
    }),
  );
  await page.getByRole('button', { name: 'Paste screenshot', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Clipboard access was blocked');
  await expect(page.getByRole('button', { name: 'Photos', exact: true })).toBeVisible();
  await expect(page.getByLabel('Instruction', { exact: true })).toHaveText('Preserve me');
  await page.evaluate(() =>
    Object.defineProperty(navigator.clipboard, 'read', {
      configurable: true,
      value: async () => [],
    }),
  );
  await page.getByRole('button', { name: 'Paste screenshot', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No image was shared');
  await expect(page.getByLabel('Message attachments')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('voice records real browser audio, cleans into a draft, preserves typing and never auto-sends', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.grantPermissions(['microphone']);
  await page.route('**/api/voice', (r) => r.fulfill({ json: { enabled: true, maxSeconds: 180 } }));
  let submissions = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/(messages|tasks|steer)$/.test(r.url())) submissions++;
  });
  await page.route('**/dictation?*', async (r) => {
    expect(r.request().headers()['content-type']).toBe('application/octet-stream');
    expect(r.request().postDataBuffer()!.length).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await r.fulfill({
      json: {
        text: 'Keep port 42. Do not send automatically.',
        original: 'um keep port 42 uh do not send automatically',
        cleaned: true,
      },
    });
  });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  const draft = page.getByLabel('Instruction', { exact: true });
  await draft.fill('Existing draft');
  await page.getByRole('button', { name: 'Dictate message', exact: true }).click();
  await expect(page.getByText(/Listening ·/)).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/screenshots/voice-recording-mobile.png' });
  await page.getByRole('button', { name: 'Finish dictation', exact: true }).click();
  await expect(page.getByText('Transcribing and cleaning up…')).toBeVisible();
  await draft.fill('Typing while transcribing');
  await expect(draft).toHaveText(
    'Typing while transcribing\nKeep port 42. Do not send automatically.',
  );
  expect(await draft.evaluate((el) => el.clientHeight)).toBeGreaterThan(60);
  expect(submissions).toBe(0);
  await page.getByText('Original transcription', { exact: true }).click();
  await expect(
    page.getByText('um keep port 42 uh do not send automatically', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/voice-draft-mobile.png' });
  await page.route('**/api/sessions/*/messages', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ json: { mode: 'send' } });
  });
  await page.getByRole('button', { name: /^(Send message|Steer active turn)$/ }).click();
  await expect(draft).toHaveText('');
  await draft.fill('New draft while the acknowledgement arrives');
  await expect(page.getByLabel('Voice input', { exact: true })).toHaveCount(0);
  await expect(draft).toHaveText('New draft while the acknowledgement arrives');
  await page.getByRole('button', { name: 'Dictate message', exact: true }).click();
  await expect(page.getByText(/Listening ·/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel voice input' }).click();
  await expect(page.getByLabel('Voice input', { exact: true })).toHaveCount(0);
  expect(submissions).toBe(1);
});

test('voice permission refusal preserves the draft; service failure keeps audio for retry', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.route('**/api/voice', (r) => r.fulfill({ json: { enabled: true, maxSeconds: 180 } }));
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  await page.getByLabel('Instruction', { exact: true }).fill('Keep my draft');
  await context.clearPermissions();
  await page.evaluate(() => {
    (window as any).originalMic = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Denied', 'NotAllowedError');
    };
  });
  await page.getByRole('button', { name: 'Dictate message', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Microphone access was blocked');
  await expect(page.getByLabel('Instruction', { exact: true })).toHaveText('Keep my draft');
  await page.getByRole('button', { name: 'Dismiss voice input' }).click();
  await context.grantPermissions(['microphone']);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = (window as any).originalMic;
  });
  let attempts = 0;
  await page.route('**/dictation?*', async (r) => {
    attempts++;
    await r.fulfill(
      attempts === 1
        ? { status: 502, json: { error: 'Transcription failed. Retry your recording.' } }
        : {
            json: { text: 'Recovered dictation.', original: 'Recovered dictation.', cleaned: true },
          },
    );
  });
  await page.getByRole('button', { name: 'Dictate message', exact: true }).click();
  await expect(page.getByText(/Listening ·/)).toBeVisible();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Finish dictation', exact: true }).click();
  await page.getByRole('button', { name: 'Retry transcription', exact: true }).click();
  await expect(page.getByLabel('Instruction', { exact: true })).toHaveText(
    'Keep my draft\nRecovered dictation.',
  );
  expect(attempts).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('holding a session opens its action sheet; rename and pin persist and scrolling cancels the hold', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  const row = page.locator('.session-row').filter({ hasText: 'Atlas API' }).first();
  const box = (await row.boundingBox())!;
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x + 70, y: box.y + 30 }],
  });
  await page.waitForTimeout(650);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const sheet = page.locator('dialog.session-action-sheet');
  await expect(sheet).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/session-actions-mobile.png' });
  await sheet.getByRole('button', { name: 'Rename', exact: true }).click();
  await sheet.getByLabel('Conversation name').fill('Pinned mobile project');
  await sheet.getByRole('button', { name: 'Save name' }).click();
  await expect(
    page.locator('.session-row').filter({ hasText: 'Pinned mobile project' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Actions for Pinned mobile project' }).click();
  await page.getByRole('button', { name: 'Pin to top' }).click();
  await page.reload();
  await openSessions(page);
  await page.getByRole('button', { name: 'Actions for Pinned mobile project' }).click();
  await expect(page.getByRole('button', { name: 'Unpin', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.locator('.session-action-sheet')).toHaveCount(0);
  const current = page.locator('.session-row').filter({ hasText: 'Pinned mobile project' });
  const pos = (await current.boundingBox())!;
  await page.mouse.move(pos.x + 60, pos.y + 30);
  await page.mouse.down();
  await page.mouse.move(pos.x + 60, pos.y + 55);
  await page.waitForTimeout(600);
  await page.mouse.up();
  await expect(page.locator('.session-action-sheet')).toHaveCount(0);
  await openSessions(page);
  await page.getByRole('button', { name: 'Actions for Pinned mobile project' }).click();
  await page.getByRole('button', { name: 'Close conversation', exact: true }).click();
  await expect(page.getByText(/The agent and queued work keep running/)).toBeVisible();
  await page.getByRole('button', { name: 'Move to History', exact: true }).click();
  await expect(
    page.locator('.session-row').filter({ hasText: 'Pinned mobile project' }),
  ).toHaveCount(0);
  // Restore to avoid changing shared fixture assumptions in other tests.
  const sessions = await (await page.request.get('/api/sessions')).json();
  const s = sessions.sessions.find((s: any) => s.relayName === 'Pinned mobile project');
  await page.request.patch(`/api/sessions/${s.id}/preferences`, {
    headers: { 'x-rc-request': '1' },
    data: { name: null, pinned: false, archived: false },
  });
});

test('DSH native questions render choices and submit the exact answer batch without sending a chat turn', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  let submitted: any;
  let messages = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/(messages|tasks|steer)$/.test(r.url())) messages++;
  });
  await page.route('**/api/sessions/*', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    if (data.session) {
      data.session.harness = 'dsh';
      data.session.agentPreset = 'haxor';
      data.session.capabilities.answerQuestion = true;
      data.interactions = [
        {
          id: 'dsh-card',
          nativeRequestId: 'native-event',
          sessionId: data.session.id,
          nativeSessionId: 'native-session',
          generation: data.session.generation,
          source: 'dsh',
          status: 'pending',
          leaseUntil: Date.now() + 60000,
          expiresAt: '2099-01-01T00:00:00Z',
          route: 'dsh-native',
          type: 'free-text',
          prompt: 'DSH needs your input',
          choices: [],
          metadata: {
            dshQuestions: [
              {
                id: 'layout',
                question: 'Which layout?',
                options: [{ label: 'Compact', description: 'Fits on a phone' }, { label: 'Wide' }],
              },
              {
                id: 'features',
                question: 'Which features?',
                multiSelect: true,
                options: [{ label: 'Files' }, { label: 'Voice' }],
              },
            ],
          },
          responseSchema: { type: 'object' },
        },
      ];
    }
    await route.fulfill({ json: data });
  });
  await page.route('**/api/interactions/dsh-card/respond', async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true } });
  });
  await page.reload();
  await page.getByRole('radio', { name: /Compact/ }).check();
  await page.getByRole('checkbox', { name: 'Files', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Voice', exact: true }).check();
  await page.screenshot({ path: 'docs/screenshots/dsh-question-mobile.png' });
  await page.getByRole('button', { name: 'Send response', exact: true }).click();
  await expect
    .poll(() => submitted)
    .toEqual({
      response: {
        answers: [
          { id: 'layout', selected: ['Compact'], custom: '' },
          { id: 'features', selected: ['Files', 'Voice'], custom: '' },
        ],
      },
    });
  expect(messages).toBe(0);
});

test('Claude commands and background notifications render as readable mobile chat activity', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  const { sessions } = await page.evaluate(async () => (await fetch('/api/sessions')).json());
  const session = sessions.find((s: any) => s.project === 'Atlas API') ?? sessions[0];
  const texts = [
    '<command-name>/goal</command-name><command-message>goal</command-message><command-args>Make the project production ready by morning.</command-args>',
    '<local-command-stdout>Goal set: Make the project production ready by morning.</local-command-stdout>',
    '<task-notification><task-id>background-check</task-id><tool-use-id>call-123</tool-use-id><output-file>/tmp/claude/session/tasks/background-check.output</output-file><status>completed</status><summary>Background integration checks completed (exit code 0)</summary><result>All tests pass. No production changes.</result></task-notification>',
  ];
  await page.route('**/events?*', (route) =>
    route.fulfill({
      json: {
        events: texts.map((text, index) => ({
          id: `native-command-${index}`,
          sourceId: `claude-${index}`,
          sequence: 9999990 + index,
          sessionId: session.id,
          nativeSessionId: session.nativeSessionId,
          source: 'claude',
          kind: 'user.message',
          timestamp: new Date().toISOString(),
          data: { text },
        })),
      },
    }),
  );
  await page.reload();
  await openSessions(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  await expect(page.locator('.message-command')).toHaveText('/goal');
  await expect(page.locator('.user-message')).toHaveCount(1);
  await expect(page.getByText('Background task completed', { exact: true })).toBeVisible();
  await expect(
    page.getByText(/<command-name>|<local-command-stdout>|<task-notification>/),
  ).toHaveCount(0);
  const details = page.locator('.native-activity').filter({ hasText: 'Background task completed' });
  await expect(details.locator('dd').filter({ hasText: '/tmp/claude/' })).toBeHidden();
  await details.locator('summary').click();
  await expect(details.locator('dd').filter({ hasText: '/tmp/claude/' })).toBeVisible();
  await expect(
    details.locator('dd').filter({ hasText: 'All tests pass. No production changes.' }),
  ).toBeVisible();
  await details.locator('summary').click();
  for (const width of [320, 390, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'docs/screenshots/native-command-cleanup-mobile.png' });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.screenshot({ path: 'docs/screenshots/native-command-cleanup-dark.png' });
});

test('generated artifacts arrive live, preview, download, and replay once', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  const { sessions } = await page.evaluate(async () => (await fetch('/api/sessions')).json());
  const session = sessions.find((s: any) => s.project === 'Atlas API');
  const image = await readFile('apps/web/public/icon-512.png');
  const query = new URLSearchParams({
    requestId: crypto.randomUUID(),
    generation: session.generation,
    name: 'relay-preview.png',
    mime: 'image/png',
    title: 'Artifact delivery test',
    caption: 'Preview fixture uploaded through the real artifact API.',
  });
  const url = `/api/sessions/${session.id}/artifacts?${query}`;
  const publish = () =>
    page.request.post(url, {
      headers: { 'content-type': 'application/octet-stream', 'x-rc-request': '1' },
      data: image,
    });
  const first = await publish();
  expect(first.ok()).toBeTruthy();
  const event = (await first.json()).event;
  expect((await (await publish()).json()).event.id).toBe(event.id);
  const card = page
    .getByRole('article', { name: 'Generated artifact' })
    .filter({ hasText: 'Artifact delivery test' });
  await expect(card).toHaveCount(1);
  await expect(card.locator('button img')).toBeVisible();
  await card.getByRole('button', { name: 'relay-preview.png', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview relay-preview.png' });
  await expect(dialog).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download image', exact: true }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe('relay-preview.png');
  expect(await readFile((await file.path())!)).toEqual(image);
  await page.getByRole('button', { name: 'Close image preview' }).click();
  await page.reload();
  await expect(card).toHaveCount(1);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/screenshots/generated-artifact-mobile.png' });
});

test('cold mobile launch repairs a restored chat marker with no app back entry', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  const fresh = await context.newPage();
  await fresh.setViewportSize({ width: 390, height: 844 });
  await fresh.addInitScript(() => history.replaceState({ relayChat: true }, '', location.href));
  await fresh.goto('/');
  await fresh.getByLabel('Instruction', { exact: true }).waitFor();
  await fresh.goBack();
  await expect(fresh.getByRole('dialog', { name: 'Sessions', exact: true })).toBeVisible();
  await fresh.close();
});

test('an attention status does not disable a native steering-capable composer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/sessions', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.sessions = data.sessions.map((s: any) =>
      s.project === 'Atlas API'
        ? {
            ...s,
            status: 'blocked',
            connected: true,
            capabilities: { ...s.capabilities, steerActiveTurn: true },
          }
        : s,
    );
    await route.fulfill({ json: data });
  });
  await page.route('**/api/sessions/*', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    if (data.session?.project === 'Atlas API') {
      data.session.status = 'blocked';
      data.session.connected = true;
      data.session.capabilities.steerActiveTurn = true;
      data.interactions = [];
    }
    await route.fulfill({ json: data });
  });
  await page.routeWebSocket('**/ws', (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => {
      const data = JSON.parse(String(message));
      if (data.type === 'invalidate')
        data.sessions = data.sessions.map((s: any) =>
          s.project === 'Atlas API'
            ? {
                ...s,
                status: 'blocked',
                capabilities: { ...s.capabilities, steerActiveTurn: true },
              }
            : s,
        );
      ws.send(JSON.stringify(data));
    });
  });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  await page.getByLabel('Instruction', { exact: true }).fill('A follow-up for the active turn');
  await expect(page.getByRole('button', { name: 'Steer active turn', exact: true })).toBeEnabled();
  await expect(
    page.getByText('This agent cannot be steered yet. Choose Queue to schedule a follow-up.'),
  ).toHaveCount(0);
});

test('DSH steering acknowledgement stays distinct from an applied model update', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const adapt = (s: any) =>
    s.project === 'Atlas API'
      ? {
          ...s,
          harness: 'dsh',
          agentPreset: 'haxor',
          status: 'working',
          capabilities: { ...s.capabilities, steerActiveTurn: true, attachFiles: true },
        }
      : s;
  await page.route('**/api/sessions', async (route) => {
    const data = await (await route.fetch()).json();
    data.sessions = data.sessions.map(adapt);
    await route.fulfill({ json: data });
  });
  await page.route('**/api/sessions/*', async (route) => {
    const data = await (await route.fetch()).json();
    if (data.session) {
      data.session = adapt(data.session);
      data.interactions = [];
    }
    await route.fulfill({ json: data });
  });
  await page.routeWebSocket('**/ws', (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => {
      const data = JSON.parse(String(message));
      if (data.type === 'invalidate') data.sessions = data.sessions.map(adapt);
      ws.send(JSON.stringify(data));
    });
  });
  let submissions = 0;
  await page.route('**/api/sessions/*/messages', async (route) => {
    submissions++;
    await route.fulfill({ json: { mode: 'steer' } });
  });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  await page.getByLabel('Instruction', { exact: true }).fill('Steering feedback fixture');
  await page.getByRole('button', { name: 'Steer active turn', exact: true }).click();
  await expect(
    page.getByText('Delivered · applies at the next supported step', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Steering accepted. DSH will apply it at the next step.'),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('Delivered · applies at the next supported step', { exact: true }),
  ).toBeVisible();
  expect(submissions).toBe(1);
});

test('notifications ignore ended-session floods and deduplicate native events across reloads', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('relay-notifications', 'on');
    (window as any).testNotifications = [];
    (window as any).Notification = class {
      static permission = 'granted';
      constructor(title: string, options: unknown) {
        (window as any).testNotifications.push({ title, options });
      }
    };
    Object.defineProperty(document, 'visibilityState', { get: () => 'hidden' });
    if (navigator.serviceWorker) navigator.serviceWorker.getRegistration = async () => undefined;
  });
  let inject: ((message: unknown) => void) | undefined;
  await page.routeWebSocket('**/ws', (ws) => {
    inject = (message) => ws.send(JSON.stringify(message));
    ws.connectToServer();
  });
  await pair(page);
  const sessions = await page.evaluate(
    async () => (await (await fetch('/api/sessions')).json()).sessions,
  );
  for (let i = 0; i < 23; i++) {
    inject!({
      type: 'invalidate',
      sessions: sessions.map((s: any) => ({ ...s, status: i % 2 ? 'working' : 'ended' })),
    });
  }
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as any).testNotifications)).toHaveLength(0);
  const event = {
    id: 'notification-proof',
    sourceId: 'notification-proof',
    sessionId: sessions[0].id,
    timestamp: new Date().toISOString(),
    kind: 'question',
    data: { interactionId: 'pending-proof' },
    sequence: 999,
  };
  inject!({ type: 'event', event });
  inject!({ type: 'event', event });
  await expect.poll(() => page.evaluate(() => (window as any).testNotifications.length)).toBe(1);
  const shown = await page.evaluate(() => (window as any).testNotifications[0]);
  expect(shown.title).toBe('Your agent needs input');
  expect(shown.options.tag).toBe(`relay-session:${sessions[0].id}`);
  expect(shown.options.renotify).toBe(false);
  await page.reload();
  await page.getByRole('button', { name: 'Open sessions', exact: true }).waitFor();
  inject!({ type: 'event', event: { ...event, timestamp: new Date().toISOString() } });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as any).testNotifications)).toHaveLength(0);
});

test('native image references render OpenUI previews with full-size view and download', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=',
    'base64',
  );
  await page.route('**/api/sessions/*/media/*/0', (r) =>
    r.fulfill({ contentType: 'image/png', body: png }),
  );
  await page.route('**/api/sessions/*/events?*', async (r) => {
    const sessionId = new URL(r.request().url()).pathname.split('/')[3];
    await r.fulfill({
      json: {
        events: [
          ...Array.from({ length: 30 }, (_, i) => ({
            id: `media-history-${i}`,
            sourceId: `media-history-${i}`,
            sessionId,
            nativeSessionId: 'native',
            source: 'dsh',
            sequence: i + 1,
            kind: 'assistant.message',
            timestamp: new Date().toISOString(),
            data: {
              text: `Earlier reply ${i}. The image viewer must outlive this virtualized history.`,
            },
          })),
          {
            id: 'f9c8b6c5-a983-4878-a9c4-122837a11cd3',
            sourceId: 'native-picture',
            sessionId,
            nativeSessionId: 'native',
            source: 'dsh',
            sequence: 100,
            kind: 'assistant.message',
            timestamp: new Date().toISOString(),
            data: {
              text: 'Here is your generated portrait.\n\n![Portrait from Comfy](/work/portrait.png)',
            },
          },
        ],
      },
    });
  });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  const preview = page.getByRole('button', { name: 'View Portrait from Comfy' });
  await expect(preview).toBeVisible();
  expect(
    await preview
      .locator('img')
      .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
  ).toBe(true);
  await preview.click();
  await expect(page.getByRole('dialog', { name: 'Preview Portrait from Comfy' })).toBeVisible();
  const zoom = page.getByRole('slider', { name: 'Image zoom' });
  await zoom.focus();
  await zoom.press('ArrowRight');
  await expect(zoom).toHaveValue('1.25');
  await page.locator('.conversation-scroll').evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Preview Portrait from Comfy' })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download file', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe('portrait.png');
  await page.getByRole('button', { name: 'Close image preview' }).click();
  await page.screenshot({ path: '/tmp/relay-native-media-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Claude task metadata is collapsed and earlier conversation paging requests completed messages', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let older = 0;
  await page.route('**/api/sessions/*/events?*', async (r) => {
    const url = new URL(r.request().url());
    expect(url.searchParams.get('conversation')).toBe('1');
    const sessionId = url.pathname.split('/')[3];
    const base = {
      sessionId,
      nativeSessionId: 'native',
      source: 'claude',
      timestamp: new Date().toISOString(),
    };
    if (Number(url.searchParams.get('before')) < Number.MAX_SAFE_INTEGER) {
      older++;
      await r.fulfill({
        json: {
          events: [
            {
              ...base,
              id: 'old-message',
              sourceId: 'old',
              sequence: 1,
              kind: 'user.message',
              data: { text: 'Earlier conversation recovered' },
            },
          ],
        },
      });
      return;
    }
    await r.fulfill({
      json: {
        events: Array.from({ length: 100 }, (_, i) => ({
          ...base,
          id: `history-${i}`,
          sourceId: `history-${i}`,
          sequence: i + 100,
          kind: 'user.message',
          data: {
            text:
              i === 99
                ? '<task-notification><summary>Background checks finished</summary></task-notification><system-reminder>Internal continuation context</system-reminder>'
                : `Earlier instruction ${i}`,
          },
        })),
      },
    });
  });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  await expect(
    page
      .locator('.native-activity summary')
      .getByText('Background checks finished', { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('.user-message').filter({ hasText: '<task-notification>' }),
  ).toHaveCount(0);
  await page.locator('.conversation-scroll').evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.getByRole('button', { name: 'Load earlier messages' }).click();
  await expect(page.getByText('Earlier conversation recovered', { exact: true })).toBeVisible();
  expect(older).toBe(1);
});

test('native close request on untouched mobile launch opens sessions instead of exiting', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  const fresh = await context.newPage();
  await fresh.setViewportSize({ width: 390, height: 844 });
  await fresh.goto('/');
  await fresh.getByLabel('Instruction', { exact: true }).waitFor();
  // Escape is Chromium's desktop native close request, the same CloseWatcher path
  // used by Android Back. history.back() alone misses Chrome's history intervention.
  expect(await fresh.evaluate(() => 'CloseWatcher' in window)).toBe(true);
  await fresh.keyboard.press('Escape');
  await expect(fresh.getByRole('dialog', { name: 'Sessions', exact: true })).toBeVisible();
  await fresh.getByRole('button', { name: 'Close sessions', exact: true }).click();
  await fresh.keyboard.press('Escape');
  await expect(fresh.getByRole('dialog', { name: 'Sessions', exact: true })).toBeVisible();
  await fresh.close();
});

test('session permission picker confirms native changes and displays failure', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let current = 'workspace-write';
  let changes = 0;
  await page.route('**/api/sessions/*/permissions', async (r) => {
    if (r.request().method() === 'POST') {
      if (changes) {
        await r.fulfill({
          status: 409,
          json: { error: 'Permissions changed. Reload the current settings before applying.' },
        });
        return;
      }
      const body = r.request().postDataJSON();
      expect(body).toEqual({ value: 'read-only', expected: 'workspace-write', confirm: true });
      current = body.value;
      changes++;
    }
    await r.fulfill({
      json: {
        supported: true,
        current,
        options: [
          { value: 'read-only', name: 'Read only' },
          { value: 'workspace-write', name: 'Workspace write' },
          { value: 'danger-full-access', name: 'Full access' },
        ],
      },
    });
  });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  await page.getByRole('button', { name: 'Session details', exact: true }).click();
  await page.getByLabel('Permission preset', { exact: true }).selectOption('read-only');
  await expect(page.getByRole('button', { name: 'Apply settings', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Apply this change to this session' }).check();
  await page.getByRole('button', { name: 'Apply settings', exact: true }).click();
  await expect(page.getByText('Settings saved in the harness.')).toBeVisible();
  expect(changes).toBe(1);
  await expect(page.getByLabel('Permission preset', { exact: true })).toHaveValue('read-only');
  await page.screenshot({ path: '/tmp/relay-permissions-mobile.png' });
  await page.getByLabel('Permission preset', { exact: true }).selectOption('danger-full-access');
  await expect(page.getByText(/Full access lets this agent/)).toBeVisible();
  await page.getByRole('checkbox', { name: 'Apply this change to this session' }).check();
  await page.getByRole('button', { name: 'Apply settings', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Permissions changed');
  expect(changes).toBe(1);
});

test('composer keeps pasted text plain, supports multiline caret edits and Undo', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const editor = page.getByRole('textbox', { name: 'Instruction', exact: true });
  await editor.fill('Before OLD after');
  await editor.evaluate((el) => {
    const range = document.createRange();
    range.setStart(el.firstChild!, 7);
    range.setEnd(el.firstChild!, 10);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.evaluate(async () =>
    navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob(['first\nsecond'], { type: 'text/plain' }),
        'text/html': new Blob(
          ['<b>first</b><br><i>second</i><img src="https://invalid.example/track.png">'],
          { type: 'text/html' },
        ),
      }),
    ]),
  );
  await page.keyboard.press('Control+v');
  await expect(editor).toHaveText('Before first\nsecond after', { useInnerText: true });
  await expect(editor.locator('b,i,img')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(editor).toHaveText('Before OLD after');
  await page.keyboard.press('Control+Shift+z');
  await expect(editor).toHaveText('Before first\nsecond after', { useInnerText: true });
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Control+Enter');
  await page.keyboard.type('Third line');
  await expect.poll(() => editor.innerText()).toBe('Before first\nsecond after\nThird line');
  await page.reload();
  await expect(editor).toHaveText('Before first\nsecond after\nThird line');
});

test('IME composition remains editable and does not submit on a composing shortcut', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  const editor = page.getByRole('textbox', { name: 'Instruction', exact: true });
  await editor.fill('Draft ');
  await editor.press('Control+End');
  let submissions = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/(messages|tasks|steer)$/.test(r.url())) submissions++;
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: '你好', selectionStart: 2, selectionEnd: 2 });
  await page.keyboard.press('Control+Enter');
  expect(submissions).toBe(0);
  await cdp.send('Input.insertText', { text: '你好' });
  await expect(editor).toHaveText('Draft 你好');
});

test('Settings exposes the published native Android APK separately from PWA installation', async ({
  page,
}) => {
  await page.route('**/api/android', (route) =>
    route.fulfill({
      json: {
        available: true,
        version: '0.1.0',
        url: 'https://fred.example.test/api/android/apk',
      },
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  const link = page.getByRole('link', { name: 'Download Android APK · 0.1.0' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', 'https://fred.example.test/api/android/apk');
  await expect(
    page.getByRole('button', { name: 'How to install Relay', exact: true }),
  ).toBeVisible();
});

test('confirmed receipt keeps one bubble until native echo without resend and preserves the next draft', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  const { sessions } = await page.evaluate(async () => (await fetch('/api/sessions')).json());
  const id = sessions[0].id;
  await page.evaluate((id) => {
    localStorage.setItem(
      `relay-outgoing:${id}`,
      JSON.stringify([
        {
          key: crypto.randomUUID(),
          prompt: 'Previously delivered instruction',
          started: new Date().toISOString(),
          state: 'uncertain',
        },
      ]),
    );
    sessionStorage.setItem(`relay-draft:${id}`, 'Keep my next instruction');
  }, id);
  let confirmed = false;
  let nativeSeen = false;
  let posts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/(messages|steer|tasks)$/.test(request.url())) posts++;
  });
  await page.route('**/message-receipts/*', (route) =>
    route.fulfill({
      json: { nativeSeen, confirmed },
    }),
  );
  await page.goto('/?session=' + id);
  await expect(page.locator('.outgoing-message')).toContainText('Delivery not confirmed');
  confirmed = true;
  await expect(page.locator('.outgoing-message').getByRole('status')).toHaveText(
    'Delivered · waiting for agent response',
    {
      timeout: 12000,
    },
  );
  await expect(page.locator('.outgoing-message')).toHaveCount(1);
  nativeSeen = true;
  await expect(page.locator('.outgoing-message')).toHaveCount(0, { timeout: 12000 });
  await expect(page.getByLabel('Instruction', { exact: true })).toHaveText(
    'Keep my next instruction',
  );
  await page.screenshot({ path: 'test-results/web-receipt-parity.png' });
  await page.reload();
  await expect(page.locator('.outgoing-message')).toHaveCount(0);
  await expect(page.getByLabel('Instruction', { exact: true })).toHaveText(
    'Keep my next instruction',
  );
  expect(posts).toBe(0);
});

test('Stop current turn requires confirmation and sends only an interrupt request', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  const { sessions } = await page.evaluate(async () => (await fetch('/api/sessions')).json());
  const s = sessions.find((s: any) => s.project === 'Atlas API') ?? sessions[0];
  await page.evaluate(async (id) => {
    const response = await fetch(`/api/sessions/${id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-RC-Request': '1' },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        prompt: 'Keep working for steering UI test',
        attachments: [],
      }),
    });
    if (!response.ok) throw new Error('Fixture turn did not start');
  }, s.id);
  let stops = 0;
  await page.route('**/interrupt', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({ confirm: true });
    expect(route.request().url()).toContain(`/sessions/${s.id}/interrupt`);
    stops++;
    await route.fulfill({ json: { ok: true } });
  });
  await page.reload();
  await openSessions(page);
  await page
    .getByRole('button', {
      name: `Actions for ${s.displayName || s.name || s.project}`,
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Stop current turn', exact: true }).click();
  expect(stops).toBe(0);
  await page.getByRole('button', { name: 'Stop turn', exact: true }).click();
  await expect.poll(() => stops).toBe(1);
  await expect(page.locator('.session-action-sheet')).toHaveCount(0);
});

test('session settings separate permissions and Plan mode with explicit confirmation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let mode = 'default';
  let permission = 'custom:fixture';
  const writes: any[] = [];
  for (const kind of ['permissions', 'mode'])
    await page.route(`**/api/sessions/*/${kind}`, async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        writes.push({ kind, ...body });
        if (kind === 'mode') mode = body.value;
        else permission = body.value;
      }
      await route.fulfill({
        json: {
          supported: true,
          current: kind === 'mode' ? mode : permission,
          currentName: kind === 'mode' ? mode : 'Custom session permissions',
          options:
            kind === 'mode'
              ? [
                  { value: 'default', name: 'Build' },
                  { value: 'plan', name: 'Plan', description: 'Applies to subsequent turns.' },
                ]
              : [
                  { value: ':workspace', name: 'Workspace' },
                  { value: ':danger-full-access', name: 'Full access / bypass approvals' },
                ],
        },
      });
    });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  await page.getByRole('button', { name: 'Session details', exact: true }).click();
  await page.getByLabel('Mode', { exact: true }).selectOption('plan');
  const modeSection = page.getByRole('region', { name: 'Agent mode' });
  await expect(modeSection.getByRole('button', { name: 'Apply settings' })).toBeDisabled();
  await modeSection.getByRole('checkbox').check();
  await modeSection.getByRole('button', { name: 'Apply settings' }).click();
  await expect(modeSection.getByRole('status')).toHaveText('Settings saved in the harness.');
  expect(writes).toEqual([{ kind: 'mode', value: 'plan', expected: 'default', confirm: true }]);
  await page.screenshot({ path: '/tmp/relay-session-settings-mobile.png', fullPage: true });
});

test('Codex native question answers use the interaction route instead of a chat turn', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  let submitted: any;
  let sends = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/(messages|tasks|steer)$/.test(r.url())) sends++;
  });
  await page.route('**/api/sessions/*', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    if (data.session)
      data.interactions = submitted
        ? []
        : [
            {
              id: 'codex-question',
              route: 'codex-native',
              type: 'free-text',
              status: 'pending',
              expiresAt: '2099-01-01T00:00:00Z',
              prompt: 'Which color?',
              metadata: {
                questions: [
                  {
                    id: 'color',
                    question: 'Which color?',
                    options: [
                      { label: 'Blue', description: 'Use blue' },
                      { label: 'Green', description: 'Use green' },
                    ],
                  },
                ],
              },
            },
          ];
    await route.fulfill({ json: data });
  });
  await page.route('**/api/interactions/codex-question/respond', async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true } });
  });
  await page.reload();
  await page.getByRole('radio', { name: /Blue/ }).check();
  await page.screenshot({ path: '/tmp/relay-codex-question-mobile.png' });
  await page.getByRole('button', { name: 'Send response', exact: true }).click();
  await expect
    .poll(() => submitted)
    .toEqual({ response: { answers: { color: { answers: ['Blue'] } } } });
  expect(sends).toBe(0);
});

test('new project folder and confirmed launch permissions work on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  let launched: any;
  await page.route('**/api/launch', async (route) => {
    launched = route.request().postDataJSON();
    await route.fulfill({
      json: {
        requestId: launched.requestId,
        hostId: 'demo',
        status: 'started',
        terminalId: 'new-test-terminal',
      },
    });
  });
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await page.getByRole('button', { name: 'New project folder', exact: true }).click();
  await page.getByLabel('Project folder name').fill('Phone project');
  await page.getByRole('button', { name: 'Create and use folder' }).click();
  await expect(page.locator('.folder-choice')).toContainText('/Phone project');
  await page.getByLabel('Session permissions', { exact: true }).selectOption('plan');
  await page.getByLabel('First message').fill('Plan the new project');
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  expect(launched).toBeUndefined();
  await page.getByLabel('Use these permissions for the new session').check();
  await page.getByLabel('First message').focus();
  await page.screenshot({ path: '/tmp/relay-project-launch-web.png' });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '/tmp/relay-project-launch-dark.png' });
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await expect.poll(() => launched?.permission).toBe('plan');
  expect(launched.permissionConfirmed).toBe(true);
  expect(launched.cwd).toMatch(/\/Phone project$/);
});

test('Codex command approval exposes native choices and never sends a chat turn', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  let submitted: any;
  let sends = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/(messages|tasks|steer)$/.test(r.url())) sends++;
  });
  await page.route('**/api/sessions/*', async (route) => {
    const data = await (await route.fetch()).json();
    if (data.session)
      data.interactions = submitted
        ? []
        : [
            {
              id: 'codex-approval',
              metadata: {},
              route: 'codex-native',
              type: 'command-approval',
              status: 'pending',
              expiresAt: '2099-01-01T00:00:00Z',
              prompt: 'touch example',
              choices: [
                { id: 'accept', label: 'Allow once' },
                { id: 'cancel', label: 'Deny and stop turn' },
              ],
              responseSchema: { type: 'string', enum: ['accept', 'cancel'] },
            },
          ];
    await route.fulfill({ json: data });
  });
  await page.route('**/api/interactions/codex-approval/respond', async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true } });
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Deny and stop turn' }).click();
  await expect.poll(() => submitted).toEqual({ response: 'cancel' });
  expect(sends).toBe(0);
});

test.describe('download links', () => {
  test.use({ serviceWorkers: 'block' });
  test('chat Markdown file links download without leaving the conversation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await pair(page);
    await page.route('**/api/sessions/*/events?*', async (route) => {
      const data = await (await route.fetch()).json();
      data.events = [
        {
          id: 'download-link',
          sequence: 1,
          kind: 'assistant.message',
          timestamp: new Date().toISOString(),
          data: { text: '[Download Relay](/api/android/apk)' },
        },
      ];
      await route.fulfill({ json: data });
    });
    await page.route('**/api/android/apk', (route) =>
      route.fulfill({
        headers: {
          'content-type': 'application/vnd.android.package-archive',
          'content-disposition': 'attachment; filename="relay-test.apk"',
        },
        body: 'mock APK download',
      }),
    );
    await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
    await page.reload();
    const url = page.url();
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download Relay', exact: true }).click();
    expect((await download).suggestedFilename()).toBe('relay-test.apk');
    expect(page.url()).toBe(url);
  });
});

test('agent task view shows native progress with the message queue secondary', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.route(/\/api\/sessions\/[^/?]+$/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      json: {
        ...body,
        plan: {
          text: 'Repair launch',
          steps: [
            { text: 'Inspect saved receipt', status: 'completed' },
            { text: 'Verify recovery', status: 'in_progress' },
            { text: 'Publish APK', status: 'pending' },
          ],
        },
      },
    });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Agent tasks', exact: true }).click();
  await expect(page.getByRole('heading', { name: '1 of 3 completed' })).toBeVisible();
  await expect(page.getByText('Verify recovery', { exact: false })).toBeVisible();
  await expect(page.getByText('Follow-ups run in order', { exact: false })).not.toBeVisible();
  await page.screenshot({ path: '/tmp/relay-agent-tasks-mobile.png', fullPage: true });
});

test('mobile native model picker applies a catalog model without submitting a message', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/sessions', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const s of body.sessions) s.capabilities.changeModel = true;
    await route.fulfill({ response, json: body });
  });
  await page.routeWebSocket('**/ws', (socket) => {
    socket.connectToServer().onMessage((message) => {
      const data = JSON.parse(String(message));
      if (data.type === 'invalidate')
        for (const session of data.sessions) session.capabilities.changeModel = true;
      socket.send(JSON.stringify(data));
    });
  });
  let model = 'old-model';
  let changes = 0;
  const catalog = () => ({
    current: { provider: 'openai', model },
    default: { provider: 'openai', model },
    reason: 'Applies to subsequent turns. A running turn keeps its current model.',
    groups: [
      {
        id: 'openai',
        name: 'OpenAI',
        models: [
          { id: 'old-model', name: 'Old model' },
          { id: 'new-model', name: 'New model' },
        ],
      },
    ],
  });
  await page.route('**/api/sessions/*/models', (route) => route.fulfill({ json: catalog() }));
  await page.route('**/api/sessions/*/model', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ provider: 'openai', model: 'new-model' });
    model = 'new-model';
    changes++;
    await route.fulfill({ json: catalog() });
  });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  await page.getByRole('button', { name: 'Session details', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Model', exact: true })
    .selectOption(JSON.stringify({ provider: 'openai', model: 'new-model' }));
  await page.getByRole('button', { name: 'Apply model', exact: true }).click();
  await expect(page.getByText('Model selection saved.', { exact: true })).toBeVisible();
  expect(changes).toBe(1);
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue(
    JSON.stringify({ provider: 'openai', model: 'new-model' }),
  );
  await page.screenshot({ path: 'test-results/model-picker-mobile.png', fullPage: true });
});

test('OpenUI response renders chart/table/form, saves a draft, and replays without duplication', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  const { sessions } = await page.evaluate(async () => (await fetch('/api/sessions')).json());
  const session = sessions.find((s: any) => s.project === 'Atlas API');
  const source = `heading = CardHeader("Render comparison", "Same seed")
chart = BarChart(["Turbo", "Teacher"], [Series("Seconds", [25, 236])])
table = Table([Col("Model", ["Turbo", "Teacher"]), Col("Steps", [8, 40], "number")])
form = Form("nextRender", Buttons([Button("Use these settings", Action([@ToAssistant("Prepare the next render")]))]), [FormControl("Direction", Input("direction", "Describe the next version", "text"))])
root = Stack([heading, chart, table, form])`;
  const query = new URLSearchParams({
    requestId: crypto.randomUUID(),
    generation: session.generation,
    name: 'comparison.openui',
    title: 'Interactive comparison',
  });
  const publish = await page.request.post(`/api/sessions/${session.id}/artifacts?${query}`, {
    headers: { 'content-type': 'application/octet-stream', 'x-rc-request': '1' },
    data: source,
  });
  expect(publish.ok()).toBeTruthy();
  const card = page
    .getByRole('article', { name: 'Generated artifact' })
    .filter({ hasText: 'Interactive comparison' });
  await expect(card.getByText('Render comparison', { exact: true })).toBeVisible();
  await expect(card.getByRole('table')).toBeVisible();
  await expect(card.getByRole('img', { name: 'Bar chart', exact: true })).toBeVisible();
  await card.getByPlaceholder('Describe the next version').fill('Keep the same character');
  await card.getByRole('button', { name: 'Use these settings', exact: true }).click();
  await expect(page.getByLabel('Instruction', { exact: true })).toContainText(
    'Prepare the next render',
  );
  await expect(page.getByLabel('Instruction', { exact: true })).toContainText(
    'Keep the same character',
  );
  await expect(card.getByRole('status')).toHaveText(
    'Added to your draft. Review and send when ready.',
  );
  await page.screenshot({ path: 'docs/screenshots/openui-mobile.png' });
  await page.reload();
  await expect(card).toHaveCount(1);
  await expect(card.getByPlaceholder('Describe the next version')).toHaveValue(
    'Keep the same character',
  );
});

test('published video plays inline, seeks with byte ranges, and downloads real bytes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  const { sessions } = await page.evaluate(async () => (await fetch('/api/sessions')).json());
  const session = sessions.find((s: any) => s.project === 'Atlas API');
  const bytes = await readFile('packages/testing/fixtures/preview.mp4');
  const query = new URLSearchParams({
    requestId: crypto.randomUUID(),
    generation: session.generation,
    name: 'preview.mp4',
    mime: 'video/mp4',
    title: 'Inline video',
  });
  expect(
    (
      await page.request.post(`/api/sessions/${session.id}/artifacts?${query}`, {
        headers: { 'content-type': 'application/octet-stream', 'x-rc-request': '1' },
        data: bytes,
      })
    ).ok(),
  ).toBeTruthy();
  const card = page
    .getByRole('article', { name: 'Generated artifact' })
    .filter({ hasText: 'Inline video' });
  const video = card.locator('video');
  await expect(video).toBeVisible();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(1);
  await video.evaluate((v: HTMLVideoElement) => {
    v.currentTime = 1;
  });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThanOrEqual(1);
  const downloaded = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Download file', exact: true }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe('preview.mp4');
  expect(await readFile((await file.path())!)).toEqual(bytes);
  await page.screenshot({ path: 'docs/screenshots/inline-video-mobile.png' });
});

test('agent tasks show native checklist and open view-only subagent conversations', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const child = 'a'.repeat(64);
  await page.route('**/api/sessions/*', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (body.session)
      body.plan = {
        steps: [{ text: 'Check generated images', status: 'in_progress' }],
        text: '',
        updatedAt: new Date().toISOString(),
      };
    await route.fulfill({ response, json: body });
  });
  await page.route('**/api/sessions/*/subagents', (route) =>
    route.fulfill({
      json: {
        supported: true,
        subagents: [
          {
            id: child,
            nativeSessionId: 'child',
            name: 'Image reviewer',
            model: 'Test model',
            updatedAt: new Date().toISOString(),
            status: 'observed',
          },
        ],
      },
    }),
  );
  await page.route('**/api/sessions/*/subagents/*/events?*', (route) =>
    route.fulfill({
      json: {
        events: [
          {
            id: 'child-message',
            sourceId: 'native-child',
            sessionId: child,
            nativeSessionId: 'child',
            source: 'codex',
            sequence: 1,
            timestamp: new Date().toISOString(),
            kind: 'assistant.message',
            data: { text: 'The generated images look good.' },
          },
        ],
      },
    }),
  );
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  await page.getByRole('button', { name: 'Agent tasks', exact: true }).click();
  await expect(page.getByText('Check generated images')).toBeVisible();
  await page.getByRole('button', { name: 'Sub-agent conversations', exact: true }).click();
  await page.getByRole('button', { name: /Image reviewer/ }).click();
  await expect(page.getByText('The generated images look good.')).toBeVisible();
  await expect(page.getByText('View only · Test model')).toBeVisible();
  await expect(page.getByRole('textbox', { name: /Message/ })).toHaveCount(0);
  await page.screenshot({ path: '/tmp/relay-subagent-phone.png' });
});

test('Claude native question cards show choices and send exact batch answers', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const request = {
    id: 'claude-question-proof',
    source: 'claude',
    route: 'claude-hook',
    status: 'pending',
    type: 'single-choice',
    expiresAt: '2100-01-01T00:00:00Z',
    prompt: 'Which framework?',
    choices: [],
    metadata: {
      questionFormat: 'choice-batch',
      dshQuestions: [
        {
          id: '0',
          question: 'Which framework?',
          multiSelect: false,
          options: [
            { label: 'React', description: 'Component library' },
            { label: 'Vue', description: 'Progressive framework' },
          ],
        },
      ],
    },
  };
  let submitted: any;
  await page.route('**/api/sessions/*', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (body.session) {
      body.session.status = 'blocked';
      body.session.capabilities.answerQuestion = true;
      body.interactions = [{ ...request, sessionId: body.session.id }];
    }
    await route.fulfill({ response, json: body });
  });
  await page.route('**/api/interactions/claude-question-proof/respond', async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: { ...request, status: 'resolved' } });
  });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  await expect(page.getByRole('heading', { name: 'Which framework?', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: /React Component library/ }).check();
  await page.getByRole('button', { name: 'Send response', exact: true }).click();
  await expect
    .poll(() => submitted)
    .toEqual({ response: { answers: [{ id: '0', selected: ['React'], custom: '' }] } });
  await page.screenshot({ path: '/tmp/relay-claude-question-phone.png' });
});

test('long-press provider swap chooses model and permissions and retains the exact restart request', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // This tests the idle restart form; earlier suite tests mutate the shared mock's turn state.
  await page.routeWebSocket('**/ws', () => {});
  await page.route('**/api/sessions', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const session of body.sessions) session.status = 'idle';
    await route.fulfill({ response, json: body });
  });
  await pair(page);
  const state = await (await page.request.get('/api/sessions')).json();
  const s =
    state.sessions.find((s: any) => s.sessionName === 'Atlas API' || s.project === 'Atlas API') ??
    state.sessions[0];
  await page.route(`**/api/sessions/${s.id}/provider-swap`, async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: {
          supported: true,
          generation: s.generation,
          profiles: [
            {
              id: 'proxy',
              label: 'Codex CFRproxy',
              provider: 'CFRproxy',
              connected: true,
              models: [{ id: 'fred/flash-next', name: 'Flash Next' }],
              defaultModel: 'fred/flash-next',
              allowCustomModel: true,
              permissions: [{ id: 'ask', name: 'Ask before changes' }],
            },
          ],
        },
      });
    const body = route.request().postDataJSON();
    expect(body.generation).toBe(s.generation);
    expect(body.profileId).toBe('proxy');
    expect(body.permission).toBe('ask');
    expect(body.model).toBe('fred/flash-next');
    expect(body.confirm).toBe(true);
    return route.fulfill({
      json: {
        requestId: body.requestId,
        status: 'started',
        diagnostic: 'Conversation resumed. Queued work remains paused for review.',
      },
    });
  });
  await page.route(`**/api/sessions/${s.id}/provider-swap/*`, (route) =>
    route.fulfill({
      json: {
        status: 'started',
        diagnostic: 'Conversation resumed. Queued work remains paused for review.',
      },
    }),
  );
  const row = page
    .locator('button.session-row')
    .filter({ hasText: s.relayName || s.sessionName || s.project })
    .first();
  const bounds = (await row.boundingBox())!;
  await page.mouse.move(bounds.x + 40, bounds.y + 30);
  await page.mouse.down();
  await page.waitForTimeout(550);
  await page.mouse.up();
  const sheet = page.locator('dialog.session-action-sheet');
  await sheet.getByRole('button', { name: 'Swap provider', exact: true }).click();
  await expect(sheet.getByRole('combobox', { name: 'Provider', exact: true })).toHaveValue('proxy');
  await sheet
    .getByRole('combobox', { name: 'Permissions after restart', exact: true })
    .selectOption('ask');
  await expect(sheet.getByRole('button', { name: 'Restart and resume' })).toBeDisabled();
  await sheet.getByRole('checkbox').check();
  await expect(sheet.getByRole('button', { name: 'Restart and resume' })).toBeEnabled();
  await page.screenshot({ path: 'docs/screenshots/provider-swap-mobile.png' });
  const request = page.waitForRequest(
    (r) => r.url().endsWith('/provider-swap') && r.method() === 'POST',
  );
  await sheet.getByRole('button', { name: 'Restart and resume' }).click();
  const body = (await request).postDataJSON();
  await expect(sheet.getByText(/Conversation resumed/)).toBeVisible();
  expect(
    await page.evaluate(
      (id) => JSON.parse(sessionStorage.getItem(`relay-provider-swap-${id}`)!).requestId,
      s.id,
    ),
  ).toBe(body.requestId);
  await sheet.getByRole('button', { name: 'Return to conversation' }).click();
  await expect(sheet).toHaveCount(0);
});

test('definite send rejection restores draft without an uncertain delivery bubble', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  await page.route('**/api/sessions/*/messages', (route) =>
    route.fulfill({
      status: 422,
      json: { error: 'The agent is not ready. Your draft was not sent.' },
    }),
  );
  const draft = page.getByLabel('Instruction', { exact: true });
  await draft.fill('Preserve this rejected instruction');
  await page.getByRole('button', { name: /^(Send message|Steer active turn)$/ }).click();
  await expect(draft).toHaveText('Preserve this rejected instruction');
  await expect(page.locator('.outgoing-message')).toHaveCount(0);
  await expect(
    page.getByText('The agent is not ready. Your draft was not sent.', { exact: true }).first(),
  ).toBeVisible();
});

test('QOL preferences persist with command center and accessible mobile layout', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.getByLabel('Theme', { exact: true }).selectOption('amoled');
  await page.getByLabel('Text size', { exact: true }).selectOption('large');
  await page.getByLabel('Message spacing', { exact: true }).selectOption('compact');
  await page.getByLabel('Activity detail', { exact: true }).selectOption('responses');
  await page.getByLabel('Haptic feedback', { exact: true }).check();
  await page.reload();
  await expect(page.getByLabel('Text size', { exact: true })).toHaveValue('large');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'amoled');
  await page.screenshot({ path: 'test-results/qol-settings-mobile.png' });
  await page.getByRole('button', { name: 'Back to sessions' }).click();
  await page.getByRole('button', { name: 'Show session information' }).click();
  await expect(page.getByRole('heading', { name: 'Session command center' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tasks & progress' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sub-agent conversations' })).toBeVisible();
  await page.screenshot({ path: 'test-results/qol-command-center-mobile.png' });
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('QOL safe retry retains exact payload and the newer draft', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  const { sessions } = await page.evaluate(async () => (await fetch('/api/sessions')).json());
  const id = sessions[0].id;
  const key = 'e8f297ba-8405-4ae2-9cbc-9daeb7c502a9';
  await page.evaluate(
    ({ id, key }) => {
      localStorage.setItem(
        `relay-outgoing:${id}`,
        JSON.stringify([
          {
            key,
            prompt: 'Original request',
            attachments: [],
            started: new Date().toISOString(),
            state: 'uncertain',
          },
        ]),
      );
      sessionStorage.setItem(`relay-draft:${id}`, 'Newer draft stays');
    },
    { id, key },
  );
  await page.route('**/message-receipts/*', (r) =>
    r.fulfill({ json: { confirmed: false, nativeSeen: false } }),
  );
  const requests: unknown[] = [];
  await page.route('**/api/sessions/*/messages', (r) => {
    requests.push(r.request().postDataJSON());
    return r.fulfill({ json: { mode: 'send' } });
  });
  await page.goto(`/?session=${id}`);
  await page.getByRole('button', { name: 'Retry safely', exact: true }).click();
  await expect(page.locator('.outgoing-message')).toContainText('Delivered');
  expect(requests).toEqual([{ idempotencyKey: key, prompt: 'Original request', attachments: [] }]);
  await expect(page.getByLabel('Instruction', { exact: true })).toHaveText('Newer draft stays');
});

test('QOL answer tray expires locally and never hides behind activity filters', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  const expiresAt = new Date(Date.now() + 12000).toISOString();
  await page.route(/\/api\/sessions\/[^/?]+$/, async (r) => {
    const data = await (await r.fetch()).json();
    data.interactions = [
      {
        id: 'qol-question',
        choices: [],
        sessionId: data.session.id,
        type: 'free-text',
        status: 'pending',
        title: 'Choose the next step',
        prompt: 'What next?',
        metadata: {},
        expiresAt: expiresAt,
      },
    ];
    await r.fulfill({ json: data });
  });
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  await page.reload();
  await page.getByRole('button', { name: /Needs your answer · 1/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Needs your answer' });
  await expect(dialog.getByRole('heading', { name: 'What next?' })).toBeVisible();
  await page.screenshot({ path: 'test-results/qol-answer-tray-mobile.png' });
  await expect(dialog.getByText('No unanswered requests. You’re all caught up.')).toBeVisible({
    timeout: 15000,
  });
});

test('QOL text artifact preview and share preserve the exact file bytes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  const { sessions } = await page.evaluate(async () => (await fetch('/api/sessions')).json());
  const session = sessions.find((s: any) => s.project === 'Atlas API');
  const content = '<script>window.shouldNeverExecute = true</script>\nProject notes.';
  const query = new URLSearchParams({
    requestId: crypto.randomUUID(),
    generation: session.generation,
    name: 'qol-notes.html',
    mime: 'text/html',
    title: 'QOL document',
  });
  const response = await page.request.post(`/api/sessions/${session.id}/artifacts?${query}`, {
    headers: { 'content-type': 'application/octet-stream', 'x-rc-request': '1' },
    data: content,
  });
  expect(response.ok()).toBeTruthy();
  const card = page
    .getByRole('article', { name: 'Generated artifact' })
    .filter({ hasText: 'QOL document' });
  await card.getByRole('button', { name: 'Preview file', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview qol-notes.html' });
  await expect(dialog.locator('pre')).toHaveText(content);
  expect(await page.evaluate(() => (window as any).shouldNeverExecute)).toBeUndefined();
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false }),
  );
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Share file', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('qol-notes.html');
  expect(await readFile((await file.path())!, 'utf8')).toBe(content);
  await page.screenshot({ path: 'test-results/qol-document-preview.png' });
});

for (const width of [1280, 390]) {
  test(`browser text selection stays intact across scrolling and live updates (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await pair(page);
    const { sessions } = await page.evaluate(async () => (await fetch('/api/sessions')).json());
    const session = { ...sessions[0], status: 'working', sessionName: 'Selection acceptance' };
    const events = Array.from({ length: 40 }, (_, index) => ({
      id: `selection-${index}`,
      sourceId: `selection-native-${index}`,
      sequence: index + 1,
      sessionId: session.id,
      nativeSessionId: session.nativeSessionId,
      source: 'mock',
      kind: index % 2 ? 'assistant.message' : 'user.message',
      timestamp: new Date().toISOString(),
      data: {
        text:
          `Selection message ${index}: ` +
          'Readable content with a stable place in the conversation. '.repeat(3),
      },
    }));
    let stream: any;
    await page.route('**/api/sessions', (route) =>
      route.fulfill({ json: { sessions: [session] } }),
    );
    await page.route(`**/api/sessions/${session.id}`, (route) =>
      route.fulfill({ json: { session, tasks: [], interactions: [] } }),
    );
    await page.route('**/events?*', (route) => route.fulfill({ json: { events } }));
    await page.routeWebSocket('**/ws', (socket) => {
      stream = socket;
      socket.send(JSON.stringify({ type: 'invalidate', sessions: [session] }));
    });
    await page.reload();
    await openSessions(page);
    await page.locator('button.session-row').filter({ hasText: 'Selection acceptance' }).click();
    const pane = page.locator('.conversation-scroll');
    await pane.evaluate((element) => {
      element.scrollTop = 0;
    });
    // Both endpoints must remain available even when they are many screens apart.
    const paragraphs = page.locator('.transcript .message-content .markdown-paragraph');
    await expect(paragraphs).toHaveCount(40);
    const points = await paragraphs.first().evaluate((element) => {
      const node = element.firstChild!;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 9);
      const box = range.getBoundingClientRect();
      return { x: box.x, right: box.right, y: box.y + box.height / 2 };
    });
    await page.mouse.move(points.x + 1, points.y);
    await page.mouse.down();
    await page.mouse.move(points.right, points.y, { steps: 12 });
    await page.mouse.up();
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toMatch(/^Selection/);
    const selected = await paragraphs.evaluateAll((elements) => {
      const selection = window.getSelection()!;
      const range = document.createRange();
      range.setStart(elements[0].firstChild!, 0);
      range.setEnd(elements[20].firstChild!, 21);
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString();
    });
    expect(selected).toContain('Selection message 10:');
    expect(selected).toContain('Selection message 20:');
    await expect(page.getByRole('button', { name: 'Latest messages', exact: true })).toBeVisible();
    await pane.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    for (let index = 0; index < 3; index++)
      stream.send(
        JSON.stringify({
          type: 'event',
          event: {
            ...events[0],
            id: `selection-delta-${index}`,
            sequence: 41 + index,
            kind: 'assistant.delta',
            data: {
              itemId: 'selection-live-reply',
              text: ['A new ', 'streamed ', 'reply.'][index],
            },
          },
        }),
      );
    await expect(page.getByText('A new streamed reply.', { exact: true })).toBeAttached();
    await page.waitForTimeout(1200); // Include the receipt clock's periodic render.
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
    expect(await page.evaluate(() => window.getSelection()?.anchorNode?.isConnected)).toBe(true);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.keyboard.press('Control+c');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied.match(/Selection message \d+:/g)).toEqual(
      selected.match(/Selection message \d+:/g),
    );
    expect(copied).not.toContain('A new streamed reply.');
    await page.screenshot({ path: `test-results/selection-${width}.png` });
  });
}

test('composer Enter sends, Ctrl+Enter inserts a newline, and Escape and Stop use control routes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  const { sessions } = await page.evaluate(async () => (await fetch('/api/sessions')).json());
  const session = {
    ...sessions[0],
    status: 'working',
    capabilities: { ...sessions[0].capabilities, sendEscape: true, interruptTurn: false },
  };
  await page.route('**/api/sessions', (route) => route.fulfill({ json: { sessions: [session] } }));
  await page.route(`**/api/sessions/${session.id}`, (route) =>
    route.fulfill({ json: { session, interactions: [], tasks: [] } }),
  );
  await page.route('**/events?*', (route) => route.fulfill({ json: { events: [] } }));
  await page.routeWebSocket('**/ws', (socket) =>
    socket.send(JSON.stringify({ type: 'invalidate', sessions: [session] })),
  );
  const controls: any[] = [];
  const messages: any[] = [];
  await page.route('**/commands', async (route) => {
    controls.push(route.request().postDataJSON());
    await route.fulfill({
      json: { mode: 'command', message: 'Escape sent to the native harness.' },
    });
  });
  await page.route('**/messages', async (route) => {
    messages.push(route.request().postDataJSON());
    await route.fulfill({ json: { mode: 'steer' } });
  });
  await page.goto(`/?session=${session.id}`);
  const editor = page.getByRole('textbox', { name: 'Instruction', exact: true });
  const stop = page.getByRole('button', { name: 'Stop turn', exact: true });
  await expect(stop).toBeEnabled();
  await page.screenshot({ path: 'test-results/composer-stop-mobile.png' });
  await stop.click();
  await expect.poll(() => controls.length).toBe(1);
  await editor.fill('First');
  await editor.press('Control+End');
  await editor.press('Control+Enter');
  await page.keyboard.type('Second');
  await expect(editor).toHaveText('First\nSecond', { useInnerText: true });
  expect(messages).toHaveLength(0);
  await expect(stop).toHaveCount(0);
  await editor.press('Escape');
  await expect.poll(() => controls.length).toBe(2);
  await expect(editor).toHaveText('First\nSecond', { useInnerText: true });
  await page.getByRole('button', { name: 'Quick shortcuts', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Quick shortcuts', exact: true })).toHaveCount(0);
  expect(controls).toHaveLength(2);
  await editor.press('Enter');
  await expect.poll(() => messages.length).toBe(1);
  expect(messages[0].prompt).toBe('First\nSecond');
  await expect(editor).toHaveText('');
  await expect(stop).toBeEnabled();
  await editor.fill('Software keyboard send');
  await editor.evaluate((node) =>
    node.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertParagraph',
      }),
    ),
  );
  await expect.poll(() => messages.length).toBe(2);
  expect(messages[1].prompt).toBe('Software keyboard send');
  await expect(editor).toHaveText('');
  await expect(stop).toBeEnabled();
  expect(controls.map((c) => c.line)).toEqual(['/esc', '/esc']);
  expect(controls.every((c) => c.generation === session.generation && c.requestId)).toBe(true);
  expect(controls[0].requestId).not.toBe(controls[1].requestId);
  for (const [width, height, theme] of [
    [375, 812, 'light'],
    [430, 932, 'dark'],
    [812, 375, 'light'],
    [768, 1024, 'dark'],
    [1440, 1000, 'light'],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    await expect(stop).toBeVisible();
    const bounds = await stop.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(48);
    expect(bounds!.height).toBeGreaterThanOrEqual(48);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/composer-stop-${width}-${theme}.png` });
  }
});

test('slash commands and quick shortcuts use control routes and preserve a separate draft', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  const commands: string[] = [];
  const messages: any[] = [];
  await page.route('**/api/sessions/*/commands', async (route) => {
    const body = route.request().postDataJSON();
    commands.push(body.line);
    expect(body.requestId).toBeTruthy();
    expect(body.generation).toBeTruthy();
    await route.fulfill({ json: { mode: 'command', message: 'Native command complete' } });
  });
  await page.route('**/api/sessions/*/messages', async (route) => {
    messages.push(route.request().postDataJSON());
    await route.fulfill({ json: { mode: 'send' } });
  });
  const input = page.getByLabel('Instruction', { exact: true });
  await input.fill('/compact');
  await input.press('Enter');
  await expect.poll(() => commands).toEqual(['/compact']);
  await expect(input).toHaveText('');
  expect(messages).toHaveLength(0);
  await input.fill('Keep this draft');
  await page.getByRole('button', { name: 'Quick shortcuts', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Quick shortcuts' })
    .getByRole('button', { name: 'Continue', exact: true })
    .click();
  await expect.poll(() => messages.length).toBe(1);
  expect(messages[0].prompt).toBe('Continue');
  expect(messages[0].attachments).toEqual([]);
  await expect(input).toHaveText('Keep this draft');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Quick shortcuts', exact: true }).click();
  await page.screenshot({ path: 'test-results/quick-shortcuts-mobile.png' });
});

for (const width of [390, 1280])
  test(`running DSH command is visible without expanding tool activity (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await pair(page);
    const { sessions } = await page.evaluate(async () => (await fetch('/api/sessions')).json());
    const session = {
      ...sessions[0],
      harness: 'dsh',
      sessionName: 'DSH visibility',
      status: 'working',
      capabilities: { ...sessions[0].capabilities, interruptTurn: true },
    };
    const events = [
      {
        id: 'live-tool',
        sourceId: 'native-tool',
        sequence: 500,
        sessionId: session.id,
        nativeSessionId: session.nativeSessionId,
        source: 'dsh',
        kind: 'tool.invocation',
        timestamp: new Date(Date.now() - 120000).toISOString(),
        data: {
          tool: 'bash',
          toolCallId: 'ssh-call',
          input: JSON.stringify({ command: 'ssh -o ConnectTimeout=10 desktop2025 hostname' }),
        },
      },
    ];
    await page.route('**/api/sessions', (route) =>
      route.fulfill({ json: { sessions: [session] } }),
    );
    await page.route(`**/api/sessions/${session.id}`, (route) =>
      route.fulfill({
        json: {
          session,
          interactions: [],
          tasks: [],
          terminalOutput:
            width === 1280
              ? 'Are you sure you want to continue connecting (yes/no/[fingerprint])?'
              : '',
        },
      }),
    );
    await page.route('**/events?*', (route) => route.fulfill({ json: { events } }));
    let stream: any;
    await page.routeWebSocket('**/ws', (socket) => {
      stream = socket;
      socket.send(JSON.stringify({ type: 'invalidate', sessions: [session] }));
    });
    const commands: string[] = [];
    await page.route('**/commands', async (route) => {
      commands.push(route.request().postDataJSON().line);
      await route.fulfill({ json: { mode: 'command', message: 'Current turn cancelled.' } });
    });
    await page.reload();
    await openSessions(page);
    await page.locator('button.session-row').filter({ hasText: 'DSH visibility' }).click();
    const activity = page.getByLabel('Current tool activity', { exact: true });
    await expect(
      activity.getByText('ssh -o ConnectTimeout=10 desktop2025 hostname', { exact: true }),
    ).toBeVisible();
    await expect(activity.getByText('No tool result received yet.', { exact: true })).toBeVisible();
    if (width === 390) await expect(activity).toContainText('waiting for terminal input');
    else
      await expect(activity.getByLabel('Live terminal output')).toContainText(
        'yes/no/[fingerprint]',
      );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/active-tool-${width}.png` });
    await page.getByLabel('Instruction', { exact: true }).fill('Keep my draft');
    await activity.getByRole('button', { name: 'Stop current turn', exact: true }).click();
    await expect.poll(() => commands).toEqual(['/stop']);
    await expect(page.getByLabel('Instruction', { exact: true })).toHaveText('Keep my draft');
    stream.send(
      JSON.stringify({
        type: 'event',
        event: {
          ...events[0],
          id: 'tool-done',
          sourceId: 'result',
          sequence: 501,
          kind: 'tool.output',
          data: { toolCallId: 'ssh-call', text: 'Host key verification failed.' },
        },
      }),
    );
    await expect(activity).toHaveCount(0);
  });

test('missed conversation frames recover on a healthy socket without refresh or lost drafts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  const session = await page.request
    .get('/api/sessions')
    .then((r) => r.json())
    .then((r) => r.sessions[0]);
  const initial = {
    id: 'replay-initial',
    sourceId: 'replay-initial',
    sequence: 1,
    sessionId: session.id,
    nativeSessionId: session.nativeSessionId,
    source: 'mock',
    kind: 'assistant.message',
    timestamp: new Date().toISOString(),
    data: { text: 'Initial replay history' },
  };
  const recovered = {
    ...initial,
    id: 'replay-missed',
    sourceId: 'replay-missed',
    sequence: 2,
    data: { text: 'Recovered without refreshing the page' },
  };
  let history = [initial];
  let reads = 0;
  let stream: any;
  await page.route('**/events?*', (route) => {
    reads++;
    return route.fulfill({ json: { events: history } });
  });
  await page.routeWebSocket('**/ws', (socket) => {
    stream = socket;
    socket.send(JSON.stringify({ type: 'invalidate', sessions: [session] }));
  });
  await page.goto(`/?session=${session.id}`);
  await expect(page.getByText('Initial replay history', { exact: true })).toBeVisible();
  const composer = page.getByLabel('Instruction', { exact: true });
  await composer.fill('Preserve this draft while recovering');
  const before = reads;
  history = [initial, recovered];
  stream.send(JSON.stringify({ type: 'heartbeat' }));
  await expect(
    page.getByText('Recovered without refreshing the page', { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  expect(reads).toBeGreaterThan(before);
  await expect(composer).toHaveText('Preserve this draft while recovering');
  await page.screenshot({ path: '/tmp/relay-replay-mobile.png' });
});

test('history recovery retains a stream frame received during the HTTP snapshot', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  const session = await page.request
    .get('/api/sessions')
    .then((r) => r.json())
    .then((r) => r.sessions[0]);
  const initial = {
    id: 'race-initial',
    sourceId: 'race-initial',
    sequence: 1,
    sessionId: session.id,
    nativeSessionId: session.nativeSessionId,
    source: 'mock',
    kind: 'assistant.message',
    timestamp: new Date().toISOString(),
    data: { text: 'Before snapshot race' },
  };
  let reads = 0;
  let stream: any;
  let release: (() => void) | undefined;
  await page.route('**/events?*', async (route) => {
    reads++;
    if (reads > 1)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    await route.fulfill({ json: { events: [initial] } });
  });
  await page.routeWebSocket('**/ws', (socket) => {
    stream = socket;
    socket.send(JSON.stringify({ type: 'invalidate', sessions: [session] }));
  });
  await page.goto(`/?session=${session.id}`);
  await expect(page.getByText('Before snapshot race', { exact: true })).toBeVisible();
  await expect.poll(() => !!release, { timeout: 15000 }).toBe(true);
  stream.send(
    JSON.stringify({
      type: 'event',
      event: {
        ...initial,
        id: 'race-live',
        sequence: 2,
        data: { text: 'Live frame survives snapshot recovery' },
      },
    }),
  );
  await expect(
    page.getByText('Live frame survives snapshot recovery', { exact: true }),
  ).toBeVisible();
  release!();
  await page.waitForResponse((r) => r.url().includes('/events?'));
  await expect(
    page.getByText('Live frame survives snapshot recovery', { exact: true }),
  ).toBeVisible();
});

test('right-side helper chooses a proxy model and preserves the current session draft', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  const mainId = new URL(page.url()).searchParams.get('session')!;
  let current: any = null;
  let launch: any;
  await page.route('**/api/helper', async (route) => {
    if (route.request().method() === 'POST') {
      launch = route.request().postDataJSON();
      current = {
        requestId: launch.requestId,
        profileId: launch.profileId,
        model: launch.model,
        id: '11111111-1111-4111-8111-111111111111',
        status: 'idle',
        messages: [
          { role: 'user', content: launch.prompt },
          { role: 'assistant', content: 'I can inspect your Relay sessions.' },
        ],
        receipt: { status: 'started' },
      };
      await route.fulfill({ json: { status: 'started', requestId: launch.requestId } });
    } else
      await route.fulfill({
        json: {
          profiles: [
            {
              id: 'my-cfr',
              label: 'My proxy',
              provider: 'CFR proxy',
              connected: true,
              defaultModel: 'proxy/model-a',
              models: [
                { id: 'proxy/model-a', name: 'Model A' },
                { id: 'proxy/model-b', name: 'Model B' },
              ],
            },
          ],
          current,
        },
      });
  });
  await page.getByLabel('Instruction', { exact: true }).fill('Keep my main session draft');
  await page.getByRole('button', { name: 'Open Relay helper' }).click();
  const helper = page.locator('dialog.helper-drawer[open]');
  await expect(helper).toBeVisible();
  await helper.getByRole('combobox', { name: 'Model', exact: true }).selectOption('proxy/model-b');
  await helper.getByLabel('Message', { exact: true }).fill('Check session health');
  await helper.getByRole('button', { name: 'Start chat', exact: true }).click();
  await expect(
    helper.getByText('I can inspect your Relay sessions.', { exact: true }),
  ).toBeVisible();
  expect(launch.profileId).toBe('my-cfr');
  expect(launch.model).toBe('proxy/model-b');
  expect(launch.prompt).toBe('Check session health');
  expect(launch.requestId).toMatch(/^[0-9a-f-]{36}$/);
  await helper.getByLabel('Message', { exact: true }).fill('Keep my helper draft');
  await page.screenshot({ path: '/tmp/relay-helper-web-chat.png' });
  await page.keyboard.press('Escape');
  await expect(helper).not.toBeVisible();
  await expect(page.getByLabel('Instruction', { exact: true })).toHaveText(
    'Keep my main session draft',
  );
  expect(new URL(page.url()).searchParams.get('session')).toBe(mainId);
  await page.getByRole('button', { name: 'Open Relay helper' }).click();
  await expect(helper.getByLabel('Message', { exact: true })).toHaveValue('Keep my helper draft');
  await page.goBack();
  await expect(helper).not.toBeVisible();
  for (const theme of ['light', 'dark']) {
    for (const width of [320, 375, 430, 768, 1440]) {
      await page.setViewportSize({ width, height: width === 768 ? 430 : 844 });
      await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
      await page.getByRole('button', { name: 'Open Relay helper' }).click();
      await helper.getByRole('button', { name: 'New conversation', exact: true }).click();
      await expect(helper.getByRole('combobox', { name: 'Model', exact: true })).toBeVisible();
      expect(await helper.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.screenshot({ path: `/tmp/relay-helper-${theme}-${width}.png` });
      await helper.getByRole('button', { name: 'Back to conversation', exact: true }).click();
      await helper.getByRole('button', { name: 'Close helper' }).click();
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Open Relay helper' }).click();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
});

test('composer exposes native token counters, thinking, model and confirmed permissions', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/sessions', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const s of body.sessions) s.capabilities.changeModel = true;
    await route.fulfill({ response, json: body });
  });
  await page.routeWebSocket('**/ws', (socket) => {
    socket.connectToServer().onMessage((message) => {
      const data = JSON.parse(String(message));
      if (data.type === 'invalidate')
        for (const s of data.sessions) s.capabilities.changeModel = true;
      socket.send(JSON.stringify(data));
    });
  });
  let effort = 'medium',
    model = 'model-a',
    permission = 'workspace-write';
  const catalog = () => ({
    current: { provider: 'proxy', model, reasoningEffort: effort },
    default: { provider: 'proxy', model: 'model-a' },
    groups: [
      {
        id: 'proxy',
        name: 'My proxy',
        models: [
          { id: 'model-a', name: 'Model A', reasoningEfforts: ['low', 'medium', 'high'] },
          {
            id: 'model-b',
            name: 'Model B',
            reasoningEfforts: ['low', 'high'],
            defaultReasoningEffort: 'low',
          },
        ],
      },
    ],
  });
  await page.route('**/api/sessions/*/models', (r) => r.fulfill({ json: catalog() }));
  let modelWrites = 0;
  await page.route('**/api/sessions/*/model', async (r) => {
    const body = r.request().postDataJSON();
    expect(r.request().headers()['x-rc-generation']).toBeTruthy();
    expect(body.provider).toBe('proxy');
    effort = body.reasoningEffort;
    model = body.model;
    modelWrites++;
    await r.fulfill({ json: catalog() });
  });
  await page.route('**/api/sessions/*/usage', (r) =>
    r.fulfill({
      json: {
        supported: true,
        input: 12000,
        output: 500,
        total: 12500,
        contextUsed: 4200,
        contextWindow: 200000,
      },
    }),
  );
  let permissionWrites = 0;
  await page.route('**/api/sessions/*/permissions', async (r) => {
    if (r.request().method() === 'POST') {
      expect(r.request().postDataJSON()).toEqual({
        value: 'read-only',
        expected: 'workspace-write',
        confirm: true,
      });
      permission = 'read-only';
      permissionWrites++;
    }
    await r.fulfill({
      json: {
        supported: true,
        current: permission,
        currentName: permission,
        options: [
          { value: 'workspace-write', name: 'Workspace write' },
          { value: 'read-only', name: 'Read only' },
        ],
      },
    });
  });
  const chatWrites: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/(messages|tasks)$/.test(new URL(r.url()).pathname))
      chatWrites.push(r.url());
  });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  await expect(page.getByRole('button', { name: 'Token usage', exact: true })).toHaveText(
    '4.2K / 200K tokens',
  );
  await page.getByRole('button', { name: 'Token usage', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Native session settings', exact: true });
  await expect(panel.getByText('12.5K tokens', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Quick thinking settings', exact: true }).click();
  await panel.getByRole('combobox', { name: 'Thinking level', exact: true }).selectOption('high');
  await panel.getByRole('button', { name: 'Apply model settings', exact: true }).click();
  await expect(panel.getByText('Native model settings saved.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Quick thinking settings' })).toHaveText(
    'Think: high',
  );
  await page.getByRole('button', { name: 'Quick model settings', exact: true }).click();
  await panel
    .getByRole('combobox', { name: 'Native model' })
    .selectOption(JSON.stringify({ provider: 'proxy', model: 'model-b' }));
  await panel.getByRole('button', { name: 'Apply model settings', exact: true }).click();
  await expect(panel.getByText('Native model settings saved.')).toBeVisible();
  expect(modelWrites).toBe(2);
  expect(effort).toBe('low');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Quick permission settings' }).click();
  await panel.getByRole('combobox', { name: 'Permission preset' }).selectOption('read-only');
  expect(permissionWrites).toBe(0);
  await panel.getByLabel('Apply this change to this session').check();
  await panel.getByRole('button', { name: 'Apply settings', exact: true }).click();
  await expect(panel.getByText('Settings saved in the harness.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Quick permission settings' })).toHaveText(
    'read-only',
  );
  expect(chatWrites).toEqual([]);
  for (const theme of ['light', 'dark'])
    for (const width of [320, 375, 430, 768, 1440]) {
      await page.setViewportSize({ width, height: width === 768 ? 430 : 844 });
      await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
      await expect(page.getByRole('button', { name: 'Token usage', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: `/tmp/relay-composer-${theme}-${width}.png` });
    }
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
});

test('DSH layout switches parent and agents without losing drafts and follows isolated child history', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  const first = 'b'.repeat(64),
    second = 'c'.repeat(64);
  const stamp = new Date().toISOString();
  let live = false;
  const event = (id: string, text: string, sequence: number, kind = 'assistant.message') => ({
    id,
    sourceId: id,
    sessionId: first,
    nativeSessionId: 'child',
    source: 'codex',
    sequence,
    timestamp: stamp,
    kind,
    data: { text, tool: 'Read' },
  });
  await page.route('**/api/sessions/*/subagents', (route) =>
    route.fulfill({
      json: {
        supported: true,
        subagents: [
          {
            id: first,
            name: 'Image reviewer',
            model: 'Test model',
            status: 'working',
            updatedAt: stamp,
          },
          {
            id: second,
            name: 'Layout inspector',
            model: 'Another model',
            status: 'observed',
            updatedAt: stamp,
          },
        ],
      },
    }),
  );
  await page.route('**/api/sessions/*/subagents/*/events?*', (route) =>
    route.fulfill({
      json: {
        events: route.request().url().includes(second)
          ? [event('second-reply', 'Layout inspector private reply', 1)]
          : [
              event('first-reply', 'Image reviewer private reply', 1),
              event('tool', 'Read screenshot metadata', 2, 'tool.invocation'),
              ...(live ? [event('live-reply', 'Live child update arrived', 3)] : []),
            ],
      },
    }),
  );
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  const message = page.getByRole('textbox', { name: 'Instruction', exact: true });
  await message.fill('Keep this parent draft');
  await page
    .getByRole('button', { name: 'Choose conversation: Main conversation', exact: true })
    .click();
  const picker = page.getByRole('dialog', { name: 'Conversations', exact: true });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: /Image reviewer/ }).click();
  await expect(page.getByText('Image reviewer private reply')).toBeVisible();
  await expect(message).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp('agent=' + first));
  live = true;
  await expect(page.getByText('Live child update arrived')).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByText('Image reviewer private reply')).toHaveCount(0);
  await expect(page.locator('.activity-group')).toHaveCount(1);
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page
    .getByRole('button', { name: 'Choose conversation: Image reviewer', exact: true })
    .click();
  await picker.getByRole('searchbox', { name: 'Find an agent' }).fill('Layout');
  await expect(picker.getByRole('button', { name: /Image reviewer/ })).toHaveCount(0);
  await picker.getByRole('button', { name: /Layout inspector/ }).click();
  await expect(page.getByText('Layout inspector private reply')).toBeVisible();
  await expect(page.getByText('Image reviewer private reply')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Layout inspector private reply')).toBeVisible();
  await page
    .getByRole('button', { name: 'Choose conversation: Layout inspector', exact: true })
    .click();
  await picker.getByRole('button', { name: /Main conversation/ }).click();
  await expect(message).toHaveText('Keep this parent draft');
  await page
    .getByRole('button', { name: 'Choose conversation: Main conversation', exact: true })
    .click();
  await page.keyboard.press('Escape');
  await expect(picker).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Choose conversation: Main conversation', exact: true }),
  ).toBeFocused();
  for (const width of [320, 375, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
    await page.screenshot({ path: `/tmp/relay-dsh-layout-${width}.png` });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole('button', { name: 'Choose conversation: Main conversation', exact: true })
    .click();
  await page.screenshot({ path: '/tmp/relay-dsh-picker-desktop.png' });
  const violations = (await new AxeBuilder({ page }).analyze()).violations;
  expect(violations).toEqual([]);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  await page
    .getByRole('button', { name: 'Choose conversation: Main conversation', exact: true })
    .click();
  await picker.getByRole('button', { name: /Image reviewer/ }).click();
  await page.screenshot({ path: '/tmp/relay-dsh-agent-dark.png' });
});

test('native goals appear in Agent tasks and commands preserve the parent draft', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let goal: any = null;
  let failRead = false;
  const commands: any[] = [];
  let chatWrites = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/(messages|tasks)$/.test(new URL(r.url()).pathname))
      chatWrites++;
  });
  await page.route('**/api/sessions/*', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: {
        ...data,
        commands: ['help', 'model', 'permissions', 'status', 'goal', 'tasks', 'agents', 'stop'].map(
          (name) => ({ name }),
        ),
      },
    });
  });
  await page.route('**/api/sessions/*/goal', (route) =>
    failRead
      ? route.fulfill({ status: 503, json: { error: 'Native connection unavailable' } })
      : route.fulfill({ json: { supported: true, goal } }),
  );
  await page.route('**/api/sessions/*/commands', (route) => {
    const body = route.request().postDataJSON();
    commands.push(body);
    if (
      body.line.startsWith('/goal ') &&
      !['/goal pause', '/goal resume', '/goal clear'].includes(body.line)
    )
      goal = {
        objective: body.line.slice(6),
        status: 'active',
        tokensUsed: 1200,
        tokenBudget: 10000,
        timeUsedSeconds: 65,
      };
    if (body.line === '/goal pause') goal.status = 'paused';
    if (body.line === '/goal resume') goal.status = 'active';
    if (body.line === '/goal clear') goal = null;
    return route.fulfill({ json: { mode: 'command', action: 'tasks', message: 'Goal updated.' } });
  });
  await pair(page);
  await page.locator('button.session-row').filter({ hasText: 'Atlas API' }).click();
  const input = page.getByLabel('Instruction', { exact: true });
  await input.fill('/goal Verify the release\nand keep existing workflows working');
  await expect(page.getByRole('button', { name: '/goal', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '/compact', exact: true })).toHaveCount(0);
  await input.press('Enter');
  const panel = page.getByRole('region', { name: 'Session goal' });
  await expect(
    panel.getByText('Verify the release\nand keep existing workflows working'),
  ).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Goal · Running' })).toBeVisible();
  await expect(panel.getByRole('progressbar', { name: 'Goal token budget' })).toHaveAttribute(
    'value',
    '1200',
  );
  await page.screenshot({ path: 'test-results/goal-tasks-mobile.png' });
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click();
  await input.fill('Keep this separate draft');
  await page.getByRole('button', { name: 'Agent tasks', exact: true }).click();
  await panel.getByRole('button', { name: 'Pause goal', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Goal · Paused' })).toBeVisible();
  await panel.getByRole('button', { name: 'Resume goal', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Goal · Running' })).toBeVisible();
  failRead = true;
  await page.waitForTimeout(5200);
  await expect(panel.getByRole('alert')).toContainText('Could not load the current goal');
  failRead = false;
  await panel.getByRole('button', { name: 'Retry goal' }).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click();
  await expect(input).toHaveText('Keep this separate draft');
  expect(commands.map((c) => c.line)).toEqual([
    '/goal Verify the release\nand keep existing workflows working',
    '/goal pause',
    '/goal resume',
  ]);
  expect(commands.every((c) => c.requestId && c.generation)).toBe(true);
  expect(chatWrites).toBe(0);
});
