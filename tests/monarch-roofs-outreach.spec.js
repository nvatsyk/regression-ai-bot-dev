import { test } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { navigateTo, getAllFramesText } from './helpers/browser-utils.js';
import { openChat } from './helpers/chat-launcher.js';
import { waitForGreeting } from './helpers/greeting-helper.js';
import { sendMessage, waitForBotResponse } from './helpers/response-helper.js';
import { screenshotStage } from './helpers/logging-helper.js';

const BOT_URL = 'https://sdemo.nextlevel.ai/Monarch-Roofs-Demo';

const REPORT_DIR = join(process.cwd(), 'reports');
const TEST_NAME  = 'Monarch Roofs outreach greeting and multi-turn flow';

const CHAT_LABELS = [
  'Text Chat', 'Chat', 'Start Chat', "Let's Chat", 'Let’s Chat', 'Start New Session',
];

test.describe('Monarch Roofs Outreach — Multi-Turn Conversation Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(420000);

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1-2: Navigate + open chat ────────────────────────────────────────
    console.log('[MONARCH] Navigating to Monarch Roofs Outreach bot...');
    await navigateTo(page, BOT_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await screenshotStage(page, REPORT_DIR, 'monarch', 'startup');

    const preOpenText = await getAllFramesText(page);
    console.log('[MONARCH] Opening chat widget (up to 90s)...');
    await openChat(page, {
      prefix: '[MONARCH]', reportDir: REPORT_DIR,
      labels: CHAT_LABELS, timeoutMs: 90000,
    });
    console.log('[MONARCH] Chat opened — waiting for panel to settle.');

    // ── Step 3: Wait for first bot greeting ───────────────────────────────────
    console.log('[MONARCH] Waiting up to 90s for first bot greeting...');
    const greetingText = await waitForGreeting(page, {
      prefix: '[MONARCH]', reportDir: REPORT_DIR,
      baselineText: preOpenText, timeoutMs: 90000,
    });
    console.log(`[MONARCH] Greeting snapshot: ${greetingText.slice(0, 300)}`);
    await screenshotStage(page, REPORT_DIR, 'monarch', 'greeting');
    console.log('[MONARCH] First greeting validated. Sending "Yes" now.');

    // ── Step 4-5: Send "Yes" and wait for second bot message ──────────────────
    const preYesText = await getAllFramesText(page);
    console.log('[MONARCH] Sending: "Yes"');
    await sendMessage(page, 'Yes', { inputWaitMs: 90000 });
    const step2Text = await waitForBotResponse(page, {
      prefix: '[MONARCH]', reportDir: REPORT_DIR,
      baselineText: preYesText, sentText: 'Yes', minExtraChars: 15, timeoutMs: 90000,
    });
    console.log(`[MONARCH] Second message snapshot: ${step2Text.slice(0, 300)}`);
    await screenshotStage(page, REPORT_DIR, 'monarch', 'after-yes');
    console.log('[MONARCH] Second bot message validated. Sending "good" now.');

    // ── Step 6-7: Send "good" and validate final bot response ────────────────
    const preGoodText = await getAllFramesText(page);
    console.log('[MONARCH] Sending: "good"');
    await sendMessage(page, 'good', { inputWaitMs: 90000 });
    const finalText = await waitForBotResponse(page, {
      prefix: '[MONARCH]', reportDir: REPORT_DIR,
      baselineText: preGoodText, sentText: 'good', minExtraChars: 15, timeoutMs: 90000,
    });
    console.log(`[MONARCH] Final response snapshot: ${finalText.slice(0, 400)}`);
    await screenshotStage(page, REPORT_DIR, 'monarch', 'after-good');

    await screenshotStage(page, REPORT_DIR, 'monarch', 'complete');
    console.log('[MONARCH] Test complete — Monarch Roofs outreach multi-turn flow verified.');
  });
});
