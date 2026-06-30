import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  sleep, navigateTo, checkAndHandleCloudflare, openChatWidget,
  waitForBotGreeting, waitForAnyNewOccurrence, sendMessage,
} from './helpers/browser-utils.js';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G4UAKGTqHPlzBth8O49KPVnI3YuRTJOMEDWbUAK9Yduh5PWal-K-IN63Klq6_9JBKp5qrESF44g4Jy2jrTdyMApCl_mGtnAAVRrCPHCMZUFmP8dYFhtGkS6oQlLZBCUMKZKc5WXy3CkKfg';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Keyless English greeting and unlock reply flow';
const TEST_NAME   = 'Keyless English greeting and unlock reply flow';

function csvEscape(v) {
  return `"${String(v).replace(/"/g, '""')}"`;
}

function logFailure(stepLabel, failedPhrase, pageText) {
  mkdirSync(REPORT_DIR, { recursive: true });
  const row = [
    new Date().toISOString(), TEST_NAME, BUG_TITLE, stepLabel, failedPhrase, pageText.slice(0, 400),
  ].map(csvEscape).join(',') + '\n';
  appendFileSync(REPORT_PATH, row);
}

test.describe('Keyless English — Greeting and Unlock Reply Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);
    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[KE2] Navigating to Keyless English bot...');
    await navigateTo(page, BOT_URL);
    await page.screenshot({ path: join(REPORT_DIR, 'ke2-startup.png') }).catch(() => {});
    await checkAndHandleCloudflare(page, '[KE2]', REPORT_DIR);

    // ── Step 2: Capture baselines, open chat ──────────────────────────────────
    const greetingPhrases = ['help', 'Hello', 'Hi', 'welcome', 'assist', 'support', 'UXE', 'Ahmed', 'Keyless', 'chat', 'today', 'can I'];
    const greetingBase = {};
    for (const p of greetingPhrases) {
      greetingBase[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    const chatOpened = await openChatWidget(page, {
      prefix: '[KE2]',
      failScreenshotPath: join(REPORT_DIR, 'ke2-open-btn-not-found.png'),
    });
    if (!chatOpened) {
      const vis = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button,[role="button"]'))
          .map(b => (b.innerText || b.textContent || '').trim()).filter(Boolean)
      ).catch(() => []);
      logFailure('Step 2: Chat button', 'no chat button found', vis.join(', '));
      throw new Error(`[KE2] Chat button not found. Visible: ${vis.join(', ')}`);
    }

    // ── Step 3: Wait for bot greeting ────────────────────────────────────────
    const greeting = await waitForBotGreeting(page, greetingPhrases, greetingBase, 70000);
    if (!greeting) {
      await page.screenshot({ path: join(REPORT_DIR, 'ke2-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', 'no greeting received', '');
    }
    expect(greeting, 'Step 3: bot did not send a greeting').toBeTruthy();
    console.log('[TEST] Greeting:', greeting);
    await page.screenshot({ path: join(REPORT_DIR, 'ke2-greeting.png') }).catch(() => {});

    // ── Step 4: Send "to unlock the key" ─────────────────────────────────────
    const replyPoll = [
      'unlock', 'sort', 'right now', 'currently', 'trying',
      'mobile app', 'mobile', 'passcode', 'RFID', 'rfid',
      'access card', 'keypad', 'method', 'How are you',
      'We can', 'can help', 'let me', 'please', 'could you',
    ];
    const replyBaselines = {};
    for (const p of replyPoll) {
      replyBaselines[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    await sendMessage(page, 'to unlock the key');
    console.log('[TEST] User message sent');
    console.log('[KE2] Sent "to unlock the key" — waiting for any bot response.');

    // ── Step 5: Validate bot replied ─────────────────────────────────────────
    const botResponse = await waitForAnyNewOccurrence(page, replyPoll, replyBaselines, 60000);
    if (!botResponse) {
      await page.screenshot({ path: join(REPORT_DIR, 'ke2-reply-fail.png') }).catch(() => {});
      logFailure('Step 5: Bot reply after "to unlock the key"', 'no response received', '');
    }
    expect(botResponse, 'Step 5: bot did not reply after "to unlock the key"').toBeTruthy();
    console.log('[TEST] Bot response received:', botResponse);
    await page.screenshot({ path: join(REPORT_DIR, 'ke2-after-unlock-msg.png') }).catch(() => {});

    await page.screenshot({ path: join(REPORT_DIR, 'ke2-complete.png') }).catch(() => {});
    console.log('[KE2] Test complete — Keyless greeting and unlock reply verified.');
  });
});
