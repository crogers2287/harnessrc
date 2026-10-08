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
  await page.getByRole('heading', { name: /^(Connect to Relay|Sessions)$/ }).waitFor();
  if (await page.getByRole('heading', { name: 'Connect to Relay' }).isVisible()) {
    await page.getByLabel('Device name').fill('Browser test');
    await page
      .getByLabel('Pairing key', { exact: true })
      .fill((await readFile(directory + '/pairing-key', 'utf8')).trim());
    await page.getByRole('button', { name: 'Connect device' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();
  await writeFile(directory + '/browser-cookies', JSON.stringify(await page.context().cookies()), {
    mode: 0o600,
  });
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
  await page.getByRole('button', { name: 'Queue instruction', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Run the project’s integration tests?' }),
  ).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/approval-mobile.png' });
  await page.getByLabel('Instruction', { exact: true }).fill('First followup');
  await page.getByRole('button', { name: 'Queue instruction', exact: true }).click();
  await page.getByLabel('Instruction', { exact: true }).fill('Second followup');
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
  await page.getByRole('button', { name: 'Back to sessions' }).click();
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
  await expect(page.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();
  await page.getByLabel('Filter by agent').selectOption('codex');
  await expect(page.locator('.inbox-heading .count')).toHaveText('10');
  await page.screenshot({ path: 'docs/screenshots/inbox-dense-mobile.png' });
  await page.getByRole('button', { name: /Project 1:/ }).click();
  await expect(page.getByRole('heading', { name: 'Chat is not connected' })).toBeVisible();
  await expect(page.getByText('Ready for your next instruction')).toHaveCount(0);
  await page.screenshot({ path: 'docs/screenshots/unbound-mobile.png' });
  await page.getByRole('button', { name: 'Back to sessions' }).click();
  await page.getByRole('button', { name: /Project 3:/ }).click();
  await page.setViewportSize({ width: 390, height: 410 });
  await page
    .getByLabel('Instruction', { exact: true })
    .fill('A draft with the software keyboard open');
  const bounds = await page
    .getByRole('button', { name: 'Queue instruction', exact: true })
    .boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(410);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/keyboard-sized-mobile.png' });
});
