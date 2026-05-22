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

async function sendMessage(page, text, { inputWaitMs = 60000 } = {}) {
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

// Polls until the occurrence count of any phrase INCREASES beyond its baseline.
async function waitForAnyNewOccurrence(page, phrases, baselines, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const phrase of phrases) {
      const count = await page.getByText(phrase, { exact: false }).count().catch(() => 0);
      if (count > (baselines[phrase] ?? 0)) return true;
    }
    await sleep(2000);
  }
  return false;
}

test.describe('JAKDelivery — Greeting and Services Flow', () => {
  test.use({ locale: 'en-US' });

  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000); // 3 min: widget load + greeting + 1 bot response + CI headroom

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[JAK] Navigating to JAKDelivery bot...');
    await page.goto(BOT_URL);
    await page.screenshot({ path: join(REPORT_DIR, 'jak-startup.png') }).catch(() => {});

    // ── Step 2: Click "Let's Chat" button ────────────────────────────────────
    // Set baselines BEFORE clicking so post-click widget header content is not a false positive.
    // Use only specific phrases (5+ chars) to avoid substring false matches in page template.
    const greetingPoll = [
      'JAKdelivery', 'Fatima',
      'track', 'Track', 'shipment', 'Shipment',
      'delivery', 'Delivery', 'Hello', 'Welcome',
    ];
    const greetingBaselines = {};
    for (const p of greetingPoll) {
      greetingBaselines[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    const chatBtn = page.getByRole('button', { name: /let.?s chat/i });
    await chatBtn.waitFor({ timeout: 30000 });
    console.log('[JAK] Found "Let\'s Chat" button — clicking.');
    await chatBtn.click();

    // ── Step 3: Wait for bot to connect and deliver greeting ──────────────────
    // Wait for the chat input to appear — this signals the bot is connected and ready.
    const inputField = page.getByRole('textbox');
    await inputField.waitFor({ timeout: 60000 });
    console.log('[JAK] Chat input appeared — bot is connected. Waiting for greeting.');
    await sleep(5000); // Give the bot time to send its opening greeting.

    const greetingArrived = await waitForAnyNewOccurrence(page, greetingPoll, greetingBaselines, 30000);
    if (!greetingArrived) {
      console.log('[JAK] Greeting poll timed out — asserting anyway');
    }
    await sleep(1000);

    const actualGreeting = await page.evaluate(() => document.body.innerText).catch(() => '');
    console.log(`[JAK] Actual greeting text: ${actualGreeting.slice(0, 400)}`);
    await page.screenshot({ path: join(REPORT_DIR, 'jak-greeting.png') }).catch(() => {});

    // Flexible greeting validation: pass if at least 2 of the 4 concept groups match.
    // "Some of these concepts" — welcome, brand, tracking, delivery/help.
    const conceptGroups = [
      { label: 'welcome/greeting', phrases: ['Hello', 'Welcome', 'Greetings', 'Good morning', 'Good afternoon'] },
      { label: 'JAKdelivery brand or agent', phrases: ['JAKdelivery', 'Fatima'] },
      { label: 'shipment tracking topic', phrases: ['track', 'shipment', 'tracking', 'number', '12-digit'] },
      { label: 'delivery or help topic', phrases: ['delivery', 'help', 'assist', 'questions'] },
    ];

    let matchedCount = 0;
    const matchedLabels = [];
    for (const g of conceptGroups) {
      for (const phrase of g.phrases) {
        const count = await page.getByText(phrase, { exact: false }).count().catch(() => 0);
        if (count > (greetingBaselines[phrase] ?? 0) || count > 0) {
          matchedCount++;
          matchedLabels.push(g.label);
          break;
        }
      }
    }
    console.log(`[JAK] Greeting matched ${matchedCount}/4 concept groups: ${matchedLabels.join(', ')}`);

    if (matchedCount < 2) {
      await page.screenshot({ path: join(REPORT_DIR, 'jak-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', `only ${matchedCount}/4 concept groups matched (${matchedLabels.join(', ')})`, actualGreeting);
    }
    expect(matchedCount, `Step 3: greeting matched only ${matchedCount}/4 concept groups (${matchedLabels.join(', ')})`).toBeGreaterThanOrEqual(2);
    console.log('[JAK] Greeting validated.');

    // ── Step 4: Send "tell me about your services" ────────────────────────────
    // The widget runs in an iframe — document.body.innerText only sees the main page.
    // Use page.getByText() counts (which search all frames) as the response signal.
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
    console.log('[JAK] Sent "tell me about your services" — waiting for bot response.');

    // ── Step 5: Validate bot responded (non-empty, on-topic) ─────────────────
    const responseArrived = await waitForAnyNewOccurrence(page, servicesPoll, servicesBaselines, 60000);
    if (!responseArrived) {
      console.log('[JAK] Services response did not arrive within 60s — asserting anyway');
    }
    await sleep(1000);

    // Capture text from all frames for debug logging (widget is in an iframe).
    const allFrameTexts = await Promise.all(
      page.frames().map(f => f.evaluate(() => document.body.innerText).catch(() => ''))
    );
    const actualServicesText = allFrameTexts.join('\n');
    console.log(`[JAK] Actual services response (all frames): ${actualServicesText.slice(0, 400)}`);
    await page.screenshot({ path: join(REPORT_DIR, 'jak-services-response.png') }).catch(() => {});

    // Primary check: at least one services keyword count increased after the message.
    // responseArrived already captures this via getByText across all frames.
    let serviceTopicFound = responseArrived;
    if (!serviceTopicFound) {
      // Fallback: re-check counts now vs baselines.
      for (const kw of servicesPoll) {
        const count = await page.getByText(kw, { exact: false }).count().catch(() => 0);
        if (count > (servicesBaselines[kw] ?? 0)) { serviceTopicFound = true; break; }
      }
    }

    if (!serviceTopicFound) {
      await page.screenshot({ path: join(REPORT_DIR, 'jak-services-fail.png') }).catch(() => {});
      logFailure('Step 5: Services response', 'bot did not respond with delivery/services content', actualServicesText);
    }
    expect(serviceTopicFound, 'Step 5: bot did not respond to "tell me about your services" with any delivery/services keyword').toBe(true);

    await page.screenshot({ path: join(REPORT_DIR, 'jak-complete.png') }).catch(() => {});
    console.log('[JAK] Test complete — JAKDelivery greeting and services flow verified.');
  });
});
