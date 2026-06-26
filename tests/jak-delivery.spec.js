import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL = 'https://sdemo.nextlevel.ai/jak-delivery';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'JAKDelivery greeting and services flow';
const TEST_NAME   = 'JAKDelivery greeting and services flow';

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

async function sendMessage(page, text, { inputWaitMs = 70000 } = {}) {
  const input = page.getByRole('textbox');
  await input.waitFor({ timeout: inputWaitMs });
  await input.fill(text);
  await input.press('Enter');
  await sleep(500);
  const stillFilled = await input.inputValue().catch(() => '');
  if (stillFilled.trim() === text.trim()) {
    const named = page.getByRole('button', { name: /^send$/i });
    const hasSend = (await named.count().catch(() => 0)) > 0;
    await (hasSend ? named : page.getByRole('button').last()).click().catch(() => {});
  }
  await sleep(8000);
}

async function waitForAnyNewOccurrence(page, phrases, baselines, timeoutMs = 70000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const phrase of phrases) {
      const count = await page.getByText(phrase, { exact: false }).count().catch(() => 0);
      if (count > (baselines[phrase] ?? 0)) return phrase;
    }
    await sleep(2000);
  }
  return null;
}

async function waitForBotGreeting(page, greetingPoll, greetingBaselines, timeoutMs = 70000) {
  const start = Date.now();
  // Wait for chat input to appear (widget loaded and bot is connected)
  await page.getByRole('textbox').waitFor({ timeout: Math.min(60000, timeoutMs) }).catch(() => {});
  // Give the bot time to send its opening message
  await sleep(5000);
  const deadline = start + timeoutMs;
  while (Date.now() < deadline) {
    for (const phrase of greetingPoll) {
      const count = await page.getByText(phrase, { exact: false }).count().catch(() => 0);
      if (count > (greetingBaselines[phrase] ?? 0)) return phrase;
    }
    await sleep(2000);
  }
  const inputVisible = await page.getByRole('textbox').isVisible().catch(() => false);
  return inputVisible ? 'greeting received' : null;
}

test.describe('JAKDelivery — Greeting and Services Flow', () => {
  test.use({ locale: 'en-US' });

  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);
    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[JAK] Navigating to JAKDelivery bot...');
    await page.goto(BOT_URL);
    await page.screenshot({ path: join(REPORT_DIR, 'jak-startup.png') }).catch(() => {});

    // ── Step 2: Open chat — capture baselines BEFORE clicking ─────────────────
    const greetingPoll = [
      'JAKdelivery', 'Fatima',
      'track', 'Track', 'shipment', 'Shipment',
      'delivery', 'Delivery', 'Hello', 'Welcome',
    ];
    const greetingBaselines = {};
    for (const p of greetingPoll) {
      greetingBaselines[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    const CHAT_LABELS = ["Let's Chat", "Let's Chat", 'Text Chat', 'Chat', 'Start Chat', 'Start New Session'];
    let chatBtn = null;
    for (const lbl of CHAT_LABELS) {
      const btn = page.getByText(lbl, { exact: false }).first();
      console.log(`[CHAT] Waiting up to 50000ms for chat button: ${lbl}`);
      const found = await btn.waitFor({ timeout: 70000 }).then(() => true).catch(() => false);
      if (found) { chatBtn = btn; break; }
    }
    if (!chatBtn) {
      chatBtn = page.getByRole('button', { name: /let.?s chat/i });
      const found = await chatBtn.waitFor({ timeout: 70000 }).then(() => true).catch(() => false);
      if (!found) {
        await page.screenshot({ path: join(REPORT_DIR, 'jak-open-btn-not-found.png') }).catch(() => {});
        throw new Error('[JAK] Chat button not found');
      }
    }
    console.log('[JAK] Found chat button — clicking.');
    await chatBtn.click();

    // ── Step 3: Wait for bot to connect and deliver greeting ──────────────────
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
    console.log('[JAK] Sent "tell me about your services" — waiting for bot response.');

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
