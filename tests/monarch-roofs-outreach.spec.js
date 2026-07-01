import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  sleep, navigateTo, waitForPageReady, checkAndHandleCloudflare, openChatWidget,
  dumpChatDebugInfo, waitForBotReply, sendMessage, getAllFramesText,
} from './helpers/browser-utils.js';

const BOT_URL = 'https://sdemo.nextlevel.ai/Monarch-Roofs-Demo';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Monarch Roofs outreach greeting and multi-turn flow';
const TEST_NAME   = 'Monarch Roofs outreach greeting and multi-turn flow';

const CHAT_LABELS = [
  'Text Chat', 'Chat', 'Start Chat', "Let's Chat", 'Let’s Chat', 'Start New Session',
];

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

test.describe('Monarch Roofs Outreach — Multi-Turn Conversation Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(420000);

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[MONARCH] Navigating to Monarch Roofs Outreach bot...');
    await navigateTo(page, BOT_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.screenshot({ path: join(REPORT_DIR, 'monarch-startup.png') }).catch(() => {});

    console.log('[MONARCH] Waiting for page to fully load...');
    await waitForPageReady(page, { timeoutMs: 90000, prefix: '[MONARCH]' });

    await checkAndHandleCloudflare(page, '[MONARCH]', REPORT_DIR, 90000);
    console.log('[MONARCH] Page loaded.');

    // ── Step 2: Open chat ─────────────────────────────────────────────────────
    const preOpenText = await getAllFramesText(page);

    console.log('[MONARCH] Opening chat widget (up to 90s)...');
    const chatOpened = await openChatWidget(page, {
      prefix: '[MONARCH]',
      labels: CHAT_LABELS,
      failScreenshotPath: join(REPORT_DIR, 'monarch-open-btn-not-found.png'),
      timeoutMs: 90000,
    });
    if (!chatOpened) {
      const debugInfo = await dumpChatDebugInfo(page, '[MONARCH]');
      logFailure('Step 2: Chat button', 'no chat button found', debugInfo.bodyText);
      throw new Error('[MONARCH] Chat button not found after 90s.');
    }
    console.log('[MONARCH] Chat opened — waiting for panel to settle.');
    await sleep(2000);

    // ── Step 3: Wait for first bot greeting ───────────────────────────────────
    console.log('[MONARCH] Waiting up to 90s for first bot greeting...');
    const greetingText = await waitForBotReply(page, {
      baselineText: preOpenText,
      timeoutMs: 90000,
    });

    console.log(`[MONARCH] First greeting detected: ${greetingText !== null}`);
    console.log(`[MONARCH] Greeting snapshot: ${(greetingText || '').slice(0, 300)}`);
    await page.screenshot({ path: join(REPORT_DIR, 'monarch-greeting.png') }).catch(() => {});

    if (!greetingText) {
      await page.screenshot({ path: join(REPORT_DIR, 'monarch-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: First greeting', 'no greeting received', await getAllFramesText(page));
    }
    expect(greetingText, 'Step 3: bot did not send a greeting').not.toBeNull();
    console.log('[MONARCH] First greeting validated. Sending "Yes" now.');

    // ── Step 4: Send "Yes" ────────────────────────────────────────────────────
    const preYesText = await getAllFramesText(page);

    console.log('[MONARCH] Sending: "Yes"');
    await sendMessage(page, 'Yes', { inputWaitMs: 90000 });

    // ── Step 5: Wait for second bot message ───────────────────────────────────
    const step2Text = await waitForBotReply(page, {
      baselineText: preYesText,
      sentText: 'Yes',
      minExtraChars: 15,
      timeoutMs: 90000,
    });

    console.log(`[MONARCH] Second bot message detected: ${step2Text !== null}`);
    console.log(`[MONARCH] Second message snapshot: ${(step2Text || '').slice(0, 300)}`);
    await page.screenshot({ path: join(REPORT_DIR, 'monarch-after-yes.png') }).catch(() => {});

    if (!step2Text) {
      await page.screenshot({ path: join(REPORT_DIR, 'monarch-step2-fail.png') }).catch(() => {});
      logFailure('Step 5: Response after "Yes"', 'no response received', await getAllFramesText(page));
    }
    expect(step2Text, 'Step 5: bot did not respond after "Yes"').not.toBeNull();
    console.log('[MONARCH] Second bot message validated. Sending "good" now.');

    // ── Step 6: Send "good" ───────────────────────────────────────────────────
    const preGoodText = await getAllFramesText(page);

    console.log('[MONARCH] Sending: "good"');
    await sendMessage(page, 'good', { inputWaitMs: 90000 });

    // ── Step 7: Validate final bot response ───────────────────────────────────
    const finalText = await waitForBotReply(page, {
      baselineText: preGoodText,
      sentText: 'good',
      minExtraChars: 15,
      timeoutMs: 90000,
    });

    console.log(`[MONARCH] Final response detected: ${finalText !== null}`);
    console.log(`[MONARCH] Final response snapshot: ${(finalText || '').slice(0, 400)}`);

    if (!finalText) {
      const allText = await page.evaluate(() =>
        Array.from(document.querySelectorAll('*'))
          .map(el => el.innerText || el.textContent || '')
          .filter(t => t.trim().length > 10)
          .slice(0, 30)
          .join(' | ')
      ).catch(() => '');
      console.log('[MONARCH] DEBUG — visible page text nodes:', allText.slice(0, 600));
    }

    await page.screenshot({ path: join(REPORT_DIR, 'monarch-after-good.png') }).catch(() => {});

    if (!finalText) {
      await page.screenshot({ path: join(REPORT_DIR, 'monarch-final-fail.png') }).catch(() => {});
      logFailure('Step 7: Final response after "good"', 'no response received', await getAllFramesText(page));
    }
    expect(finalText, 'Step 7: bot did not respond after "good"').not.toBeNull();

    await page.screenshot({ path: join(REPORT_DIR, 'monarch-complete.png') }).catch(() => {});
    console.log('[MONARCH] Test complete — Monarch Roofs outreach multi-turn flow verified.');
  });
});
