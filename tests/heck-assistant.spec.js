import { test, expect } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { sleep, navigateTo, getAllFramesText } from './helpers/browser-utils.js';
import { openChat } from './helpers/chat-launcher.js';
import { waitForGreeting } from './helpers/greeting-helper.js';
import { sendMessage, waitForBotResponse } from './helpers/response-helper.js';
import { checkPhraseGroups, logFailure, reportPathFor, screenshotStage } from './helpers/logging-helper.js';

const BOT_URL = 'https://sdemo.nextlevel.ai/heck-assistant';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = reportPathFor('heck-assistant', REPORT_DIR);
const TEST_NAME   = 'Heck Agency Assistant — Greeting and Services Flow';

test.describe('Heck Agency Assistant — Regression', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1-2: Navigate + open chat ────────────────────────────────────────
    console.log('[HECK] Navigating to bot URL...');
    await navigateTo(page, BOT_URL);
    await openChat(page, {
      prefix: '[HECK]',
      reportDir: REPORT_DIR,
      labels: ['Text Chat', 'Chat', 'Start Chat'],
      timeoutMs: 60000,
    });
    await screenshotStage(page, REPORT_DIR, 'heck', 'startup');
    console.log('[HECK] Clicked "Text Chat" button');

    // ── Step 3: Wait for + validate greeting ──────────────────────────────────
    console.log('[HECK] Waiting for greeting to load...');
    await waitForGreeting(page, { prefix: '[HECK]', reportDir: REPORT_DIR });
    await screenshotStage(page, REPORT_DIR, 'heck', 'greeting');

    const greetingFail = await checkPhraseGroups(page, [
      { label: 'Greeting opener', phrases: [
        'Hey, is this',
        'is this',
        'Hi, am i speaking',
        'am i speaking with',
      ]},
    ]);
    if (greetingFail) {
      await screenshotStage(page, REPORT_DIR, 'heck', 'greeting-fail');
      logFailure(REPORT_PATH, [TEST_NAME, 'Step 3: Greeting', greetingFail, '']);
    }
    console.log(`[HECK] ${greetingFail ? '[FAIL]' : '[PASS]'} Greeting validation`);
    expect(greetingFail, `Step 3 greeting missing: "${greetingFail}"`).toBeNull();

    // ── Step 4-5: Send "Yes" and validate response ────────────────────────────
    console.log('[HECK] Sending "Yes"...');
    const yesBaseline = await getAllFramesText(page);
    await sendMessage(page, 'Yes');
    await waitForBotResponse(page, {
      prefix: '[HECK]', reportDir: REPORT_DIR,
      baselineText: yesBaseline, sentText: 'Yes', timeoutMs: 45000,
    });
    await sleep(1000);
    await screenshotStage(page, REPORT_DIR, 'heck', 'after-yes');

    const step5Fail = await checkPhraseGroups(page, [
      { label: '"this is Jessica over at Heck Insurance"', phrases: [
        'Hey Bob, this is Jessica',
        'this is Jessica',
        'Jessica over at Heck Insurance',
        'Heck Insurance',
        'Jessica',
      ]},
    ]);
    if (step5Fail) {
      await screenshotStage(page, REPORT_DIR, 'heck', 'step5-fail');
      logFailure(REPORT_PATH, [TEST_NAME, 'Step 5: Yes response', step5Fail, '']);
    }
    console.log(`[HECK] ${step5Fail ? '[FAIL]' : '[PASS]'} Yes response validation`);
    expect(step5Fail, `Step 5 failed: missing "${step5Fail}"`).toBeNull();

    // ── Step 6-7: Send "tell me about your services" and validate response ───
    console.log('[HECK] Sending "tell me about your services"...');
    const servicesBaseline = await getAllFramesText(page);
    await sendMessage(page, 'tell me about your services');
    await waitForBotResponse(page, {
      prefix: '[HECK]', reportDir: REPORT_DIR,
      baselineText: servicesBaseline, sentText: 'tell me about your services', timeoutMs: 60000,
    });
    await sleep(1000);
    await screenshotStage(page, REPORT_DIR, 'heck', 'after-services');

    const step7Fail = await checkPhraseGroups(page, [
      { label: 'step 7 services response', phrases: [
        "I'm calling from Heck Insurance",
        'calling from Heck Insurance',
        'What had you looking around',
        'had you looking around',
        'looking around for insurance',
        'coverage details',
        'licensed agent',
        'insurance options',
        'can only assist you in English',
        'explain the call purpose',
        'quick policy review',
        'licensed Heck Insurance specialist',
        'policy review',
        'Heck Insurance specialist',
      ]},
    ]);
    if (step7Fail) {
      await screenshotStage(page, REPORT_DIR, 'heck', 'step7-fail');
      logFailure(REPORT_PATH, [TEST_NAME, 'Step 7: Services response', step7Fail, '']);
    }
    console.log(`[HECK] ${step7Fail ? '[FAIL]' : '[PASS]'} Services response validation`);
    expect(step7Fail, `Step 7 failed: missing "${step7Fail}"`).toBeNull();

    await screenshotStage(page, REPORT_DIR, 'heck', 'complete');
    console.log('[HECK] All steps passed — Heck Agency Assistant regression complete.');
  });
});
