import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL = 'https://sdemo.nextlevel.ai/Monarch-Roofs-Demo';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Monarch Roofs outreach greeting and multi-turn flow';
const TEST_NAME   = 'Monarch Roofs outreach greeting and multi-turn flow';

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

// Captures innerText from all frames (main + iframes).
async function getAllFramesText(page) {
  const parts = [];
  for (const frame of page.frames()) {
    const t = await frame.evaluate(() =>
      document.body ? document.body.innerText : ''
    ).catch(() => '');
    if (t.trim()) parts.push(t.trim());
  }
  return parts.join('\n');
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

// Polls until the count of ANY phrase increases beyond its baseline.
// Returns the matched phrase or null on timeout.
async function waitForAnyNewOccurrence(page, phrases, baselines, timeoutMs = 60000) {
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

// Snapshots current phrase counts — call this just before expecting a new bot turn.
async function captureBaselines(page, phrases) {
  const baselines = {};
  for (const p of phrases) {
    baselines[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
  }
  return baselines;
}

test.describe('Monarch Roofs Outreach — Multi-Turn Conversation Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(300000); // 5 min: greeting + 2 exchanges + CI headroom

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[MONARCH] Navigating to Monarch Roofs Outreach bot...');
    await page.goto(BOT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.screenshot({ path: join(REPORT_DIR, 'monarch-startup.png') }).catch(() => {});
    console.log('[MONARCH] Page loaded.');

    // ── Step 2: Open chat ─────────────────────────────────────────────────────
    const CHAT_LABELS = ['Text Chat', 'Chat', 'Start Chat', "Let's Chat", "Let's Chat"];
    let chatBtn = null;
    for (const lbl of CHAT_LABELS) {
      const btn = page.getByText(lbl, { exact: false }).first();
      console.log(`[CHAT] Waiting up to 30000ms for chat button: ${lbl}`);
      const found = await btn.waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
      if (found) { chatBtn = btn; break; }
    }
    if (!chatBtn) {
      const vis = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button,[role="button"]'))
          .map(b => (b.innerText || b.textContent || '').trim()).filter(Boolean)
      ).catch(() => []);
      console.log('[MONARCH] Chat button not found. Visible buttons:', vis);
      await page.screenshot({ path: join(REPORT_DIR, 'monarch-open-btn-not-found.png') }).catch(() => {});
      logFailure('Step 2: Chat button', 'no chat button found', vis.join(', '));
      throw new Error(`[MONARCH] Chat button not found. Tried: ${CHAT_LABELS.join(', ')}. Visible: ${vis.join(', ')}`);
    }
    console.log('[MONARCH] Found chat button — clicking.');
    await chatBtn.click();
    console.log('[MONARCH] Text Chat clicked.');

    // Brief pause so the chat panel can open before snapshotting baselines.
    await sleep(2000);

    // ── Step 3: Wait for first bot greeting ───────────────────────────────────
    // Outreach bot opens with a personalised greeting (e.g. "Good morning, is this Christopher?").
    // Accept any of these common opener signals.
    const GREETING_PHRASES = [
      'Good morning', 'Good afternoon', 'Good evening', 'Good day',
      'is this', 'Is this', 'speaking', 'Speaking',
      'Hello', 'Hi', 'Hey',
      'Christopher', 'certificate', 'Certificate',
      'calling', 'Calling', 'reaching out',
    ];
    const greetingBaselines = await captureBaselines(page, GREETING_PHRASES);

    console.log('[MONARCH] Waiting up to 60s for first bot greeting...');
    const matchedGreeting = await waitForAnyNewOccurrence(page, GREETING_PHRASES, greetingBaselines, 60000);

    await sleep(1000);
    const actualGreeting = await getAllFramesText(page);
    console.log(`[MONARCH] First greeting detected via phrase: "${matchedGreeting}"`);
    console.log(`[MONARCH] Actual first greeting text: ${actualGreeting.slice(0, 500)}`);
    await page.screenshot({ path: join(REPORT_DIR, 'monarch-greeting.png') }).catch(() => {});

    if (!matchedGreeting) {
      await page.screenshot({ path: join(REPORT_DIR, 'monarch-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: First greeting', 'no greeting received', actualGreeting);
    }
    expect(matchedGreeting, 'Step 3: bot did not send a greeting').not.toBeNull();
    console.log('[MONARCH] First greeting validated. Sending "Yes" now.');

    // ── Step 4: Send "Yes" ────────────────────────────────────────────────────
    // Capture baselines for the second bot turn BEFORE sending.
    const STEP2_PHRASES = [
      'How are you', 'how are you', 'How are you today', 'how are you today',
      'doing today', 'Doing today', 'feeling today',
      'hope you', 'Hope you', 'trust you',
      'today', 'morning', 'afternoon', 'evening',
    ];
    const step2Baselines = await captureBaselines(page, STEP2_PHRASES);

    console.log('[MONARCH] Sending: "Yes"');
    await sendMessage(page, 'Yes');
    console.log('[MONARCH] "Yes" sent — waiting up to 60s for second bot message.');

    // ── Step 5: Wait for second bot message ───────────────────────────────────
    const matchedStep2 = await waitForAnyNewOccurrence(page, STEP2_PHRASES, step2Baselines, 60000);

    await sleep(1000);
    const actualStep2 = await getAllFramesText(page);
    console.log(`[MONARCH] Second bot message detected via phrase: "${matchedStep2}"`);
    console.log(`[MONARCH] Actual second bot response text: ${actualStep2.slice(0, 500)}`);
    await page.screenshot({ path: join(REPORT_DIR, 'monarch-after-yes.png') }).catch(() => {});

    if (!matchedStep2) {
      await page.screenshot({ path: join(REPORT_DIR, 'monarch-step2-fail.png') }).catch(() => {});
      logFailure('Step 5: Response after "Yes"', 'no response received', actualStep2);
    }
    expect(matchedStep2, 'Step 5: bot did not respond after "Yes"').not.toBeNull();
    console.log('[MONARCH] Second bot message validated. Sending "good" now.');

    // ── Step 6: Send "good" ───────────────────────────────────────────────────
    // Use a very broad phrase set so any phrasing the bot uses is caught.
    // Baselines captured BEFORE sending so the bot's reply triggers detection.
    const FINAL_PHRASES = [
      // Expected EPC / outreach script phrases
      'Glad to hear', 'glad to hear', 'Great to hear', 'great to hear',
      'Good to hear', 'good to hear', 'Happy to hear', 'happy to hear',
      'sales call', 'not a sales', 'Energy Performance', 'energy performance',
      'Certificate', 'certificate', 'EPC', 'expired',
      'renewing', 'Renewing', 'renewal', 'Renewal',
      'roofing', 'Roofing', 'roof', 'Roof',
      // Generic follow-up phrases
      'Perfect', 'perfect', 'Wonderful', 'wonderful', 'Fantastic', 'fantastic',
      'Amazing', 'amazing', 'Awesome', 'awesome', 'Excellent', 'excellent',
      'calling', 'Calling', 'calling because', 'I am calling', "I'm calling",
      'reaching out', 'Reaching out', 'reason I', 'reason for',
      'because', 'Because', 'regarding', 'Regarding',
      'have a chance', 'Had a chance', 'look into', 'looked into',
      'That is', "That's", 'this is', "This is", "This isn",
      'help you', 'assist', 'can I', 'I can',
    ];
    const finalBaselines = await captureBaselines(page, FINAL_PHRASES);

    console.log('[MONARCH] Sending: "good"');
    await sendMessage(page, 'good');
    console.log('[MONARCH] "good" sent — waiting up to 90s for final bot response.');

    // ── Step 7: Validate final bot response ───────────────────────────────────
    const matchedFinal = await waitForAnyNewOccurrence(page, FINAL_PHRASES, finalBaselines, 90000);

    await sleep(1000);
    const actualFinal = await getAllFramesText(page);
    console.log(`[MONARCH] Final response detected via phrase: "${matchedFinal}"`);
    console.log(`[MONARCH] Actual final bot response text: ${actualFinal.slice(0, 500)}`);

    // Debug: if still no match, dump all visible text nodes for diagnosis.
    if (!matchedFinal) {
      const allText = await page.evaluate(() =>
        Array.from(document.querySelectorAll('*'))
          .map(el => el.innerText || el.textContent || '')
          .filter(t => t.trim().length > 10)
          .slice(0, 30)
          .join(' | ')
      ).catch(() => '');
      console.log('[MONARCH] DEBUG — visible page text nodes:', allText.slice(0, 600));
    }

    await page.screenshot({ path: join(REPORT_DIR, 'monarch-after-good.png') }).catch(() => {});

    if (!matchedFinal) {
      await page.screenshot({ path: join(REPORT_DIR, 'monarch-final-fail.png') }).catch(() => {});
      logFailure('Step 7: Final response after "good"', 'no response received', actualFinal);
    }
    expect(matchedFinal, 'Step 7: bot did not respond after "good"').not.toBeNull();

    await page.screenshot({ path: join(REPORT_DIR, 'monarch-complete.png') }).catch(() => {});
    console.log('[MONARCH] Test complete — Monarch Roofs outreach multi-turn flow verified.');
  });
});
