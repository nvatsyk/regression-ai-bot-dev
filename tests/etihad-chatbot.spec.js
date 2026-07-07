import { test, expect } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { sleep, navigateTo, getAllFramesText } from './helpers/browser-utils.js';
import { openChat } from './helpers/chat-launcher.js';
import { waitForGreeting } from './helpers/greeting-helper.js';
import { sendMessage, waitForBotResponse } from './helpers/response-helper.js';
import { checkPhraseGroups, logFailure, reportPathFor, screenshotStage } from './helpers/logging-helper.js';

const BOT_URL = 'https://sdemo.nextlevel.ai/etihad-chatbot';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = reportPathFor('etihad-chatbot', REPORT_DIR);
const TEST_NAME   = 'Etihad Chatbot — Greeting and Services Flow';

test.describe('Etihad Text ChatBot — Regression', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1-2: Navigate + open chat ────────────────────────────────────────
    console.log('[ETIHAD] Navigating to bot URL...');
    await navigateTo(page, BOT_URL);
    await openChat(page, {
      prefix: '[ETIHAD]',
      reportDir: REPORT_DIR,
      labels: ['Text Chat', 'Chat', 'Start Chat'],
      timeoutMs: 60000,
    });
    await screenshotStage(page, REPORT_DIR, 'etihad', 'startup');
    console.log('[ETIHAD] Clicked "Text Chat" button');

    // ── Step 3: Wait for + validate greeting ──────────────────────────────────
    console.log('[ETIHAD] Waiting for greeting to load...');
    await waitForGreeting(page, { prefix: '[ETIHAD]', reportDir: REPORT_DIR });
    await screenshotStage(page, REPORT_DIR, 'etihad', 'greeting');

    const greetingFail = await checkPhraseGroups(page, [
      { label: '"Welcome to Etihad Airways"', phrases: [
        'Welcome to Etihad Airways', 'Etihad Airways', 'Etihad',
      ]},
    ]);
    if (greetingFail) {
      await screenshotStage(page, REPORT_DIR, 'etihad', 'greeting-fail');
      logFailure(REPORT_PATH, [TEST_NAME, 'Step 3: Greeting', greetingFail, '']);
    }
    console.log(`[ETIHAD] ${greetingFail ? '[FAIL]' : '[PASS]'} Greeting validation`);
    expect(greetingFail, `Step 3 greeting missing: "${greetingFail}"`).toBeNull();

    // ── Step 4-5: Send "Hello" and validate response ──────────────────────────
    console.log('[ETIHAD] Sending "Hello"...');
    const helloBaseline = await getAllFramesText(page);
    await sendMessage(page, 'Hello');
    await waitForBotResponse(page, {
      prefix: '[ETIHAD]', reportDir: REPORT_DIR,
      baselineText: helloBaseline, sentText: 'Hello', timeoutMs: 45000,
    });
    await sleep(1000);
    await screenshotStage(page, REPORT_DIR, 'etihad', 'after-hello');

    const step5Fail = await checkPhraseGroups(page, [
      { label: '"How may I assist you"', phrases: [
        'How may I assist you', 'How may I help',
        'assist you today', 'help you today',
        'How can I help', 'How can I assist',
        'What can I do for you', 'What can I help you with',
        'Welcome to Etihad',
      ]},
    ]);
    if (step5Fail) {
      await screenshotStage(page, REPORT_DIR, 'etihad', 'step5-fail');
      logFailure(REPORT_PATH, [TEST_NAME, 'Step 5: Hello response', step5Fail, '']);
    }
    console.log(`[ETIHAD] ${step5Fail ? '[FAIL]' : '[PASS]'} Hello response validation`);
    expect(step5Fail, `Step 5 failed: missing "${step5Fail}"`).toBeNull();

    // ── Step 6-7: Send "tell me about your services" and validate response ───
    console.log('[ETIHAD] Sending "tell me about your services"...');
    const servicesBaseline = await getAllFramesText(page);
    await sendMessage(page, 'tell me about your services');
    await waitForBotResponse(page, {
      prefix: '[ETIHAD]', reportDir: REPORT_DIR,
      baselineText: servicesBaseline, sentText: 'tell me about your services', timeoutMs: 60000,
    });
    await sleep(1000);
    await screenshotStage(page, REPORT_DIR, 'etihad', 'after-services');

    const step7Fail = await checkPhraseGroups(page, [
      { label: 'services response', phrases: [
        'Just a moment',
        'flights, check flight status',
        'manage baggage',
        'arrange special services',
        'answer questions about our policies',
        'travel requirements',
        'check flight status',
        'baggage',
        'special services',
        'policies',
      ]},
    ]);
    if (step7Fail) {
      await screenshotStage(page, REPORT_DIR, 'etihad', 'step7-fail');
      logFailure(REPORT_PATH, [TEST_NAME, 'Step 7: Services response', step7Fail, '']);
    }
    console.log(`[ETIHAD] ${step7Fail ? '[FAIL]' : '[PASS]'} Services response validation`);
    expect(step7Fail, `Step 7 failed: missing "${step7Fail}"`).toBeNull();

    await screenshotStage(page, REPORT_DIR, 'etihad', 'complete');
    console.log('[ETIHAD] All steps passed — Etihad chatbot regression complete.');
  });
});
