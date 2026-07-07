import { test, expect } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { navigateTo, getAllFramesText } from './helpers/browser-utils.js';
import { openChat } from './helpers/chat-launcher.js';
import { waitForGreeting } from './helpers/greeting-helper.js';
import { sendMessage, waitForBotResponse } from './helpers/response-helper.js';
import { checkPhraseGroups, logFailure, reportPathFor, screenshotStage } from './helpers/logging-helper.js';

const BOT_URL = 'https://sdemo.nextlevel.ai/jak-delivery';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = reportPathFor('jak-delivery', REPORT_DIR);
const BUG_TITLE   = 'JAKDelivery greeting and services flow';
const TEST_NAME   = 'JAKDelivery greeting and services flow';

test.describe('JAKDelivery — Greeting and Services Flow', () => {
  test.use({ locale: 'en-US' });

  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);
    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[JAK] Navigating to JAKDelivery bot...');
    await navigateTo(page, BOT_URL);
    await screenshotStage(page, REPORT_DIR, 'jak', 'startup');

    // ── Step 2: Open chat ─────────────────────────────────────────────────────
    await openChat(page, {
      prefix: '[JAK]',
      reportDir: REPORT_DIR,
      labels: ["Let's Chat", 'Text Chat', 'Chat', 'Start Chat', 'Start New Session'],
    });
    console.log('[JAK] Found chat button — clicking.');

    // ── Step 3: Wait for + validate bot greeting ─────────────────────────────
    await waitForGreeting(page, { prefix: '[JAK]', reportDir: REPORT_DIR, timeoutMs: 70000 });
    await screenshotStage(page, REPORT_DIR, 'jak', 'greeting');

    const greetingFail = await checkPhraseGroups(page, [
      { label: 'greeting mention', phrases: [
        'JAKdelivery', 'Fatima',
        'track', 'Track', 'shipment', 'Shipment',
        'delivery', 'Delivery', 'Hello', 'Welcome',
      ]},
    ]);
    if (greetingFail) {
      await screenshotStage(page, REPORT_DIR, 'jak', 'greeting-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 3: Greeting', greetingFail, '']);
    }
    expect(greetingFail, 'Step 3: bot did not send a greeting').toBeNull();

    // ── Step 4-5: Send "tell me about your services" and validate response ───
    const servicesBaseline = await getAllFramesText(page);
    await sendMessage(page, 'tell me about your services');
    console.log('[JAK] User message sent');
    await waitForBotResponse(page, {
      prefix: '[JAK]', reportDir: REPORT_DIR,
      baselineText: servicesBaseline, sentText: 'tell me about your services', timeoutMs: 70000,
    });
    await screenshotStage(page, REPORT_DIR, 'jak', 'services-response');

    const servicesFail = await checkPhraseGroups(page, [
      { label: 'services response', phrases: [
        'shipping', 'Shipping', 'delivery', 'Delivery', 'services', 'Services',
        'tracking', 'Tracking', 'pickup', 'Pickup', 'logistics', 'Logistics',
        'shipment', 'Shipment', 'JAKdelivery', 'JAK',
      ]},
    ]);
    if (servicesFail) {
      await screenshotStage(page, REPORT_DIR, 'jak', 'services-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 5: Services response', servicesFail, '']);
    }
    expect(servicesFail, 'Step 5: bot did not respond to "tell me about your services"').toBeNull();

    await screenshotStage(page, REPORT_DIR, 'jak', 'complete');
    console.log('[JAK] Test complete — JAKDelivery greeting and services flow verified.');
  });
});
