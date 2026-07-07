import { test } from '@playwright/test';
import { navigateTo } from './helpers/browser-utils.js';
import { openChat } from './helpers/chat-launcher.js';
import { waitForGreeting } from './helpers/greeting-helper.js';
import { sendMessage } from './helpers/response-helper.js';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AGGRlTmWfaQR57k5oOyDQyQH7b0UtsALM2nJJKNB0cjv8EFCalUR6rjkR2NT-p4xv409rsKYwD-iWZdAYMEOJgpppOQjF9JyaMjlBLvrGn06sHSydcuUMhm8erOAWGPAZgbsGUEH6lKwNyBDl_-_G0L7Dn48jCLP-vAn6DWwdONuReXQUCi1JokRWYilV4m1KdtPCuoIloMYSCw';

async function openChatWithGreeting(page) {
  await navigateTo(page, BOT_URL);
  await openChat(page, { prefix: '[COSME-DEBUG]', labels: ['Text Chat'] });
  await waitForGreeting(page, { prefix: '[COSME-DEBUG]' });
  return page.getByRole('textbox');
}

test('debug: greeting', async ({ page }) => {
  await openChatWithGreeting(page);
  await page.screenshot({ path: 'cosme-debug-greeting.png', fullPage: false });
});

test('debug: services', async ({ page }) => {
  await openChatWithGreeting(page);
  await sendMessage(page, 'What services do you offer?');
  await page.screenshot({ path: 'cosme-debug-services.png', fullPage: false });
});

test('debug: location', async ({ page }) => {
  await openChatWithGreeting(page);
  await sendMessage(page, 'Where are you located?');
  await page.screenshot({ path: 'cosme-debug-location.png', fullPage: false });
});
