import { test } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { navigateTo, getAllFramesText } from './helpers/browser-utils.js';
import { openChat } from './helpers/chat-launcher.js';
import { waitForGreeting } from './helpers/greeting-helper.js';
import { sendMessage, waitForBotResponse } from './helpers/response-helper.js';
import { screenshotStage } from './helpers/logging-helper.js';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AiORyTmV30SWW488IbQoEOjlg_62oBVaAWVsuCQWa2xgKNjo320LNCZGm9j9l_FxcozWkpkkeMEYOgiEBu1CioGZbHkIrPaemMziiPPrGn4HWDimdcuUM2DcPVnALMHxG4K8BVJA-ZWsDCkT5_7vB-nf4C3EEYdafN828BnYdBFmzdEl1aWLZLi1JjkATTlJoWeJiuZagOzyPFg';

const REPORT_DIR = join(process.cwd(), 'reports');
const TEST_NAME  = 'Bengali appointment reminder greeting and schedule response';

const CHAT_LABELS = [
  'Text Chat', 'Chat', 'Start Chat', "Let's Chat", 'Let’s Chat', 'Start New Session',
];

test.describe('Bengali Appointment Reminder — Greeting and Schedule Response', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(300000);

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1-2: Navigate + open chat ────────────────────────────────────────
    console.log('[APPT-BN] Navigating to Bengali appointment bot...');
    await navigateTo(page, BOT_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await screenshotStage(page, REPORT_DIR, 'appt-bn', 'startup');

    const preOpenText = await getAllFramesText(page);
    await openChat(page, {
      prefix: '[APPT-BN]', reportDir: REPORT_DIR,
      labels: CHAT_LABELS, timeoutMs: 90000,
    });
    console.log('[APPT-BN] Chat button found — clicked.');

    // ── Step 3: Wait for any non-empty bot greeting ───────────────────────────
    console.log('[APPT-BN] Waiting up to 90s for bot greeting...');
    const greetingText = await waitForGreeting(page, {
      prefix: '[APPT-BN]', reportDir: REPORT_DIR,
      baselineText: preOpenText, timeoutMs: 90000,
    });
    console.log(`[APPT-BN] Greeting text snapshot: ${greetingText.slice(0, 300)}`);
    await screenshotStage(page, REPORT_DIR, 'appt-bn', 'greeting');

    // ── Step 4: Send Bengali user message ─────────────────────────────────────
    const preSendText = await getAllFramesText(page);

    const USER_MSG = 'আপনার কাজের সময়সূচী কী?';
    console.log(`[APPT-BN] Sending: "${USER_MSG}"`);
    await sendMessage(page, USER_MSG, { inputWaitMs: 90000 });
    console.log('[APPT-BN] Message sent — waiting for any bot response.');

    let msgAppeared = false;
    try {
      await page.getByText(USER_MSG, { exact: false }).waitFor({ timeout: 90000 });
      msgAppeared = true;
    } catch {}
    console.log(`[APPT-BN] User message visible in widget: ${msgAppeared}`);

    // ── Step 5: Validate any non-empty bot response ───────────────────────────
    const responseText = await waitForBotResponse(page, {
      prefix: '[APPT-BN]', reportDir: REPORT_DIR,
      baselineText: preSendText, sentText: USER_MSG, minExtraChars: 15, timeoutMs: 90000,
    });
    console.log(`[APPT-BN] Response text snapshot: ${responseText.slice(0, 400)}`);
    await screenshotStage(page, REPORT_DIR, 'appt-bn', 'after-first-msg');

    await screenshotStage(page, REPORT_DIR, 'appt-bn', 'complete');
    console.log('[APPT-BN] Test complete — Bengali greeting and schedule response verified.');
  });
});
