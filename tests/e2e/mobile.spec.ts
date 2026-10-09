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
  await expect(page.locator('.outgoing-message')).toContainText('Sent');
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
  await expect(page.getByRole('region', { name: 'Session information' })).toBeVisible();
  await tap('Show session information');
  await expect(page.getByRole('region', { name: 'Session information' })).not.toBeVisible();
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
  await page.getByRole('button', { name: 'Dismiss voice input' }).click();
  await page.getByRole('button', { name: 'Dictate message', exact: true }).click();
  await expect(page.getByText(/Listening ·/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel voice input' }).click();
  await expect(page.getByLabel('Voice input', { exact: true })).toHaveCount(0);
  expect(submissions).toBe(0);
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
    '<task-notification><task-id>background-check</task-id><tool-use-id>call-123</tool-use-id><output-file>/tmp/claude/session/tasks/background-check.output</output-file><status>completed</status><summary>Background integration checks completed (exit code 0)</summary></task-notification>',
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
  await expect(page.getByText('Steering accepted · waiting for the next agent step')).toBeVisible();
  await expect(
    page.getByText('Steering accepted. DSH will apply it at the next step.'),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText('Steering accepted · waiting for the next agent step')).toBeVisible();
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
  await page.locator('.conversation-scroll').evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Preview Portrait from Comfy' })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download image', exact: true }).click();
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
  await expect(page.getByRole('button', { name: 'Apply permissions', exact: true })).toBeDisabled();
  await page
    .getByRole('checkbox', { name: 'Apply this permission change to this session' })
    .check();
  await page.getByRole('button', { name: 'Apply permissions', exact: true }).click();
  await expect(page.getByText('Permissions saved in the harness.')).toBeVisible();
  expect(changes).toBe(1);
  await expect(page.getByLabel('Permission preset', { exact: true })).toHaveValue('read-only');
  await page.screenshot({ path: '/tmp/relay-permissions-mobile.png' });
  await page.getByLabel('Permission preset', { exact: true }).selectOption('danger-full-access');
  await expect(page.getByText(/Full access lets this agent/)).toBeVisible();
  await page
    .getByRole('checkbox', { name: 'Apply this permission change to this session' })
    .check();
  await page.getByRole('button', { name: 'Apply permissions', exact: true }).click();
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
  await page.keyboard.press('Enter');
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
