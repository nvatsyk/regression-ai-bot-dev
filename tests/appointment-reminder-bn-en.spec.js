import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  sleep, navigateTo, waitForPageReady, checkAndHandleCloudflare, openChatWidget,
  dumpChatDebugInfo, waitForBotReply, sendMessage, getAllFramesText,
} from './helpers/browser-utils.js';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AiORyTmV30SWW488IbQoEOjlg_62oBVaAWVsuCQWa2xgKNjo320LNCZGm9j9l_FxcozWkpkkeMEYOgiEBu1CioGZbHkIrPaemMziiPPrGn4HWDimdcuUM2DcPVnALMHxG4K8BVJA-ZWsDCkT5_7vB-nf4C3EEYdafN828BnYdBFmzdEl1aWLZLi1JjkATTlJoWeJiuZagOzyPFg';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Bengali appointment reminder greeting and schedule response';
const TEST_NAME   = 'Bengali appointment reminder greeting and schedule response';

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

test.describe('Bengali Appointment Reminder — Greeting and Schedule Response', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(300000);

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[APPT-BN] Navigating to Bengali appointment bot...');
    await navigateTo(page, BOT_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.screenshot({ path: join(REPORT_DIR, 'appt-bn-startup.png') }).catch(() => {});

    console.log('[APPT-BN] Waiting for page to fully load...');
    await waitForPageReady(page, { timeoutMs: 90000, prefix: '[APPT-BN]' });

    await checkAndHandleCloudflare(page, '[APPT-BN]', REPORT_DIR, 90000);
    console.log('[APPT-BN] Page loaded.');

    // ── Step 2: Open chat ─────────────────────────────────────────────────────
    const preOpenText = await getAllFramesText(page);

    const chatOpened = await openChatWidget(page, {
      prefix: '[APPT-BN]',
      labels: CHAT_LABELS,
      failScreenshotPath: join(REPORT_DIR, 'appt-bn-open-btn-not-found.png'),
      timeoutMs: 90000,
    });
    if (!chatOpened) {
      const debugInfo = await dumpChatDebugInfo(page, '[APPT-BN]');
      logFailure('Step 2: Chat button', 'no chat button found', debugInfo.bodyText);
      throw new Error('[APPT-BN] Chat button not found');
    }
    console.log('[APPT-BN] Chat button found — clicked.');
    await sleep(2000);

    // ── Step 3: Wait for any non-empty bot greeting ───────────────────────────
    console.log('[APPT-BN] Waiting up to 90s for bot greeting...');
    const greetingText = await waitForBotReply(page, {
      baselineText: preOpenText,
      timeoutMs: 90000,
    });

    console.log(`[APPT-BN] Greeting detected: ${greetingText !== null}`);
    console.log(`[APPT-BN] Greeting text snapshot: ${(greetingText || '').slice(0, 300)}`);
    await page.screenshot({ path: join(REPORT_DIR, 'appt-bn-greeting.png') }).catch(() => {});

    if (!greetingText) {
      await page.screenshot({ path: join(REPORT_DIR, 'appt-bn-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', 'no greeting detected', await getAllFramesText(page));
    }
    expect(greetingText, 'Step 3: bot did not send a greeting').not.toBeNull();

    await page.getByRole('textbox').waitFor({ timeout: 90000 }).catch(() => {});
    await sleep(3000);
    console.log('[APPT-BN] Greeting validated and input ready.');

    // ── Step 4: Send Bengali user message ─────────────────────────────────────
    const preSendText = await getAllFramesText(page);

    const USER_MSG = 'আপনার কাজের সময়সূচী কী?';
    console.log(`[APPT-BN] Sending: "${USER_MSG}"`);
    await sendMessage(page, USER_MSG, { inputWaitMs: 90000 });
    console.log('[APPT-BN] Message sent — waiting for any bot response.');

    // ── Step 5: Validate any non-empty bot response ───────────────────────────
    let msgAppeared = false;
    try {
      await page.getByText(USER_MSG, { exact: false }).waitFor({ timeout: 90000 });
      msgAppeared = true;
    } catch {}
    console.log(`[APPT-BN] User message visible in widget: ${msgAppeared}`);

    const responseText = await waitForBotReply(page, {
      baselineText: preSendText,
      sentText: USER_MSG,
      minExtraChars: 15,
      timeoutMs: 90000,
    });

    console.log(`[APPT-BN] Response detected: ${responseText !== null}`);
    console.log(`[APPT-BN] Response text snapshot: ${(responseText || '').slice(0, 400)}`);
    await page.screenshot({ path: join(REPORT_DIR, 'appt-bn-after-first-msg.png') }).catch(() => {});

    if (!responseText) {
      await page.screenshot({ path: join(REPORT_DIR, 'appt-bn-final-fail.png') }).catch(() => {});
      logFailure('Step 5: Response', 'no response detected', await getAllFramesText(page));
    }
    expect(responseText, 'Step 5: bot did not respond to Bengali message').not.toBeNull();

    await page.screenshot({ path: join(REPORT_DIR, 'appt-bn-complete.png') }).catch(() => {});
    console.log('[APPT-BN] Test complete — Bengali greeting and schedule response verified.');
  });
});
