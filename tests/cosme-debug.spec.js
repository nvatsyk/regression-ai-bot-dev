import { test } from '@playwright/test';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AGGRlTmWfaQR57k5oOyDQyQH7b0UtsALM2nJJKNB0cjv8EFCalUR6rjkR2NT-p4xv409rsKYwD-iWZdAYMEOJgpppOQjF9JyaMjlBLvrGn06sHSydcuUMhm8erOAWGPAZgbsGUEH6lKwNyBDl_-_G0L7Dn48jCLP-vAn6DWwdONuReXQUCi1JokRWYilV4m1KdtPCuoIloMYSCw';

async function openChat(page) {
  await page.goto(BOT_URL);
  await page.getByRole('button', { name: 'Text Chat' }).click();
  const input = page.getByRole('textbox');
  await input.waitFor({ timeout: 10000 });
  await page.getByText(/hello|hi|welcome/i).first().waitFor({ timeout: 15000 });
  return input;
}

test('debug: greeting', async ({ page }) => {
  await openChat(page);
  await page.waitForTimeout(10000);
  await page.screenshot({ path: 'cosme-debug-greeting.png', fullPage: false });
});

test('debug: services', async ({ page }) => {
  const input = await openChat(page);
  await input.fill('What services do you offer?');
  await input.press('Enter');
  await page.waitForTimeout(10000);
  await page.screenshot({ path: 'cosme-debug-services.png', fullPage: false });
});

test('debug: location', async ({ page }) => {
  const input = await openChat(page);
  await input.fill('Where are you located?');
  await input.press('Enter');
  await page.waitForTimeout(10000);
  await page.screenshot({ path: 'cosme-debug-location.png', fullPage: false });
});
