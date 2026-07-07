import { test, expect } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { navigateTo, getAllFramesText } from './helpers/browser-utils.js';
import { openChat } from './helpers/chat-launcher.js';
import { waitForGreeting } from './helpers/greeting-helper.js';
import { sendMessage, waitForBotResponse } from './helpers/response-helper.js';
import { checkPhraseGroups, logFailure, reportPathFor, screenshotStage } from './helpers/logging-helper.js';

const BOT_URL = 'https://bit.ly/Novo-Nordisk-QnA';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = reportPathFor('novo-nordisk-qa', REPORT_DIR);
const BUG_TITLE   = 'Novo Nordisk Q&A Agent greeting and GLP-1 response flow';
const TEST_NAME   = 'Novo Nordisk Q&A Agent greeting and GLP-1 response flow';

test.describe('Novo Nordisk Q&A Agent — Greeting and GLP-1 Response Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1-2: Navigate + open chat ────────────────────────────────────────
    console.log('[NOVO] Navigating to Novo Nordisk Q&A Agent...');
    await navigateTo(page, BOT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await screenshotStage(page, REPORT_DIR, 'novo', 'startup');
    console.log('[NOVO] Opening chat widget (up to 60s)...');
    await openChat(page, { prefix: '[NOVO]', reportDir: REPORT_DIR, timeoutMs: 60000 });
    console.log('[NOVO] Chat opened — waiting for panel to settle.');

    // ── Step 3: Wait for + validate greeting ──────────────────────────────────
    console.log('[NOVO] Waiting up to 60s for bot greeting...');
    const greetingText = await waitForGreeting(page, { prefix: '[NOVO]', reportDir: REPORT_DIR, timeoutMs: 60000 });
    console.log(`[NOVO] Actual greeting text: ${greetingText.slice(0, 500)}`);
    await screenshotStage(page, REPORT_DIR, 'novo', 'greeting');

    const greetingFail = await checkPhraseGroups(page, [
      { label: 'greeting mention', phrases: [
        'Nour', 'health coach', 'GLP-1', 'GLP1', 'medical advice',
        'not a doctor', 'help you today', 'How can I help',
        'educational', 'therapy',
      ]},
    ]);
    if (greetingFail) {
      await screenshotStage(page, REPORT_DIR, 'novo', 'greeting-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 3: Greeting', greetingFail, greetingText]);
    }
    expect(greetingFail, 'Step 3: bot did not send a greeting').toBeNull();
    console.log('[NOVO] Greeting validated. Sending user message now.');

    // ── Step 4-5: Send "explain GLP-1 therapy" and validate response ─────────
    console.log('[NOVO] Sending: "explain GLP-1 therapy"');
    const questionBaseline = await getAllFramesText(page);
    await sendMessage(page, 'explain GLP-1 therapy');
    console.log('[NOVO] Message sent — waiting up to 60s for bot response.');

    const responseText = await waitForBotResponse(page, {
      prefix: '[NOVO]', reportDir: REPORT_DIR,
      baselineText: questionBaseline, sentText: 'explain GLP-1 therapy', timeoutMs: 60000,
    });
    console.log(`[NOVO] Actual bot response: ${responseText.slice(0, 500)}`);
    await screenshotStage(page, REPORT_DIR, 'novo', 'after-glp1');

    const responseFail = await checkPhraseGroups(page, [
      { label: 'GLP-1 response', phrases: [
        'GLP-1', 'GLP1', 'therapy', 'hormone', 'hunger', 'medicine',
        'insulin', 'blood sugar', 'weight', 'reduce', 'body makes',
        'glucagon', 'appetite', 'type 2', 'diabetes',
      ]},
    ]);
    if (responseFail) {
      await screenshotStage(page, REPORT_DIR, 'novo', 'response-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 5: Bot response to GLP-1 query', responseFail, responseText]);
    }
    expect(responseFail, 'Step 5: bot did not respond to "explain GLP-1 therapy"').toBeNull();

    await screenshotStage(page, REPORT_DIR, 'novo', 'complete');
    console.log('[NOVO] Test complete — Novo Nordisk greeting and GLP-1 response verified.');
  });
});
