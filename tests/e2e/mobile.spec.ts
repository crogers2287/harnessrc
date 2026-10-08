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
  await expect(page.getByText(/Follow-up saved|Message saved/)).toBeVisible();
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
