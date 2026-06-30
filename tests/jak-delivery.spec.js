import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  navigateTo, checkAndHandleCloudflare, openChatWidget,
  waitForBotGreeting, waitForAnyNewOccurrence, sendMessage,
} from './helpers/browser-utils.js';

const BOT_URL = 'https://sdemo.nextlevel.ai/jak-delivery';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'JAKDelivery greeting and services flow';
const TEST_NAME   = 'JAKDelivery greeting and services flow';

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

test.describe('JAKDelivery — Greeting and Services Flow', () => {
  test.use({ locale: 'en-US' });

  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);
    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[JAK] Navigating to JAKDelivery bot...');
    await navigateTo(page, BOT_URL);
    await page.screenshot({ path: join(REPORT_DIR, 'jak-startup.png') }).catch(() => {});
    await checkAndHandleCloudflare(page, '[JAK]', REPORT_DIR);

    // ── Step 2: Capture baselines, open chat ─────────────────────────────────
    const greetingPoll = [
      'JAKdelivery', 'Fatima',
      'track', 'Track', 'shipment', 'Shipment',
      'delivery', 'Delivery', 'Hello', 'Welcome',
    ];
    const greetingBaselines = {};
    for (const p of greetingPoll) {
      greetingBaselines[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    const chatOpened = await openChatWidget(page, {
      prefix: '[JAK]',
      labels: ["Let's Chat", "Let's Chat", 'Text Chat', 'Chat', 'Start Chat', 'Start New Session'],
      failScreenshotPath: join(REPORT_DIR, 'jak-open-btn-not-found.png'),
    });
    if (!chatOpened) {
      logFailure('Step 2: Chat button', 'no chat button found', '');
      throw new Error('[JAK] Chat button not found');
    }
    console.log('[JAK] Found chat button — clicking.');

    // ── Step 3: Wait for bot greeting ────────────────────────────────────────
    const greeting = await waitForBotGreeting(page, greetingPoll, greetingBaselines, 70000);
    if (!greeting) {
      await page.screenshot({ path: join(REPORT_DIR, 'jak-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', 'no greeting received', '');
    }
    expect(greeting, 'Step 3: bot did not send a greeting').toBeTruthy();
    console.log('[TEST] Greeting:', greeting);
    await page.screenshot({ path: join(REPORT_DIR, 'jak-greeting.png') }).catch(() => {});

    // ── Step 4: Send "tell me about your services" ────────────────────────────
    const servicesPoll = [
      'shipping', 'Shipping', 'delivery', 'Delivery', 'services', 'Services',
      'tracking', 'Tracking', 'pickup', 'Pickup', 'logistics', 'Logistics',
      'shipment', 'Shipment', 'JAKdelivery', 'JAK',
    ];
    const servicesBaselines = {};
    for (const p of servicesPoll) {
      servicesBaselines[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    await sendMessage(page, 'tell me about your services');
    console.log('[TEST] User message sent');

    // ── Step 5: Validate bot responded ───────────────────────────────────────
    const botResponse = await waitForAnyNewOccurrence(page, servicesPoll, servicesBaselines, 70000);
    if (!botResponse) {
      await page.screenshot({ path: join(REPORT_DIR, 'jak-services-fail.png') }).catch(() => {});
      logFailure('Step 5: Services response', 'bot did not respond', '');
    }
    expect(botResponse, 'Step 5: bot did not respond to "tell me about your services"').toBeTruthy();
    console.log('[TEST] Bot response received:', botResponse);
    await page.screenshot({ path: join(REPORT_DIR, 'jak-services-response.png') }).catch(() => {});

    await page.screenshot({ path: join(REPORT_DIR, 'jak-complete.png') }).catch(() => {});
    console.log('[JAK] Test complete — JAKDelivery greeting and services flow verified.');
  });
});
