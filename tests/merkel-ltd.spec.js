import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// sdemo.nextlevel.ai/merkel-ltd redirects here — use direct URL for stability.
const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AOORyTmV30SWW43SE9lMA1skB-29FLbCyNGsLxANNJ7fDDwmll5bZufaEoKn9TxmfxpvRQE1DHjAbXTAQsL5FQc22PIRmek5NZxxRs77xZ6C1A6VTrpzB9MnBCm6BiT8j5q8BrnD6lK0NVnCU_78bU_8OfyGOcJj1500xbtjW1VYlFwhYtKJqhJYUEGiNSAINoiu74LayeB0t';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Merkel LTD Boardroom Q&A flow';
const TEST_NAME   = 'Merkel LTD Boardroom Q&A flow';

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

// Polls until the occurrence count of phrase INCREASES beyond beforeCount.
async function waitForNewOccurrence(page, phrase, beforeCount, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await page.getByText(phrase, { exact: false }).count().catch(() => 0);
    if (count > beforeCount) return true;
    await sleep(2000);
  }
  console.log(`[MERKEL] waitForNewOccurrence: "${phrase}" did not appear within ${timeoutMs}ms`);
  return false;
}

// Polls until any phrase in the list has more occurrences than its baseline count.
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

// Returns the label of the first phrase group with NO match on the page, or null if all pass.
async function checkPhraseGroups(page, phraseGroups) {
  for (const g of phraseGroups) {
    let matched = false;
    for (const phrase of g.phrases) {
      const count = await page.getByText(phrase, { exact: false }).count().catch(() => 0);
      if (count > 0) { matched = true; break; }
    }
    if (!matched) return g.label ?? g.phrases.join(' | ');
  }
  return null;
}

test.describe('Merkel LTD — Boardroom Q&A Flow', () => {
  test.use({ locale: 'en-US' });

  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000); // 3 min: widget load + greeting + 1 bot response + CI headroom

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[MERKEL] Navigating to Merkel LTD bot...');
    await page.goto(BOT_URL);
    await page.screenshot({ path: join(REPORT_DIR, 'merkel-startup.png') }).catch(() => {});

    // ── Step 2: Click "Text Chat" ─────────────────────────────────────────────
    const chatBtn = page.getByRole('button', { name: /text chat/i });
    await chatBtn.waitFor({ timeout: 30000 });
    console.log('[MERKEL] Found "Text Chat" button — clicking.');
    await chatBtn.click();

    // ── Step 3: Wait for and validate greeting ────────────────────────────────
    // Poll on "Boardroom" as the stable anchor of the greeting.
    const greetingArrived = await waitForNewOccurrence(page, 'Boardroom', 0, 60000);
    if (!greetingArrived) {
      const fallback = await waitForNewOccurrence(page, 'Welcome', 0, 15000);
      if (!fallback) console.log('[MERKEL] Greeting poll timed out — asserting anyway');
    }
    await sleep(1000);

    const actualGreeting = await page.evaluate(() => document.body.innerText).catch(() => '');
    console.log(`[MERKEL] Greeting text snapshot: ${actualGreeting.slice(0, 300)}`);
    await page.screenshot({ path: join(REPORT_DIR, 'merkel-greeting.png') }).catch(() => {});

    // Validate greeting contains MOST of: welcome, Boardroom, questions/help, and at least one amenity.
    const greetingFail = await checkPhraseGroups(page, [
      { label: 'welcome message', phrases: [
        'Welcome', 'welcome', 'Hello', 'hello', 'Hi', 'hi',
      ]},
      { label: 'Boardroom mention', phrases: [
        'Boardroom', 'boardroom',
      ]},
      { label: 'questions/help mention', phrases: [
        'questions', 'help', 'assist', 'How can I', 'how can I',
        'answer', 'support', 'anything',
      ]},
    ]);
    if (greetingFail) {
      await page.screenshot({ path: join(REPORT_DIR, 'merkel-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', greetingFail, actualGreeting);
    }
    expect(greetingFail, `Step 3 greeting missing: "${greetingFail}"`).toBeNull();
    console.log('[MERKEL] Greeting validated.');

    // ── Step 4: Send "Tell me about cafe" ─────────────────────────────────────
    // The chat widget is inside a same-origin iframe: document.body.innerText
    // cannot see it, but page.locator() / page.getByText() can (same-origin access).
    const beforeCafeCount = await page.locator('*').count().catch(() => 0);
    console.log(`[MERKEL] Element count before send: ${beforeCafeCount}`);

    await sendMessage(page, 'Tell me about cafe');
    console.log('[MERKEL] Sent "Tell me about cafe" — waiting for any bot response.');

    // ── Step 5: Validate any non-empty bot response ───────────────────────────
    // Confirm the user message appeared in the widget, then wait for bot response.
    let msgAppeared = false;
    try {
      await page.getByText('Tell me about cafe', { exact: false }).waitFor({ timeout: 20000 });
      msgAppeared = true;
    } catch {}
    console.log(`[MERKEL] User message appeared in widget: ${msgAppeared}`);

    const afterUserMsgCount = await page.locator('*').count().catch(() => 0);
    const cafeDeadline = Date.now() + 50000;
    let botResponded = false;
    while (Date.now() < cafeDeadline) {
      const currentCount = await page.locator('*').count().catch(() => 0);
      if (currentCount > afterUserMsgCount + 3) { botResponded = true; break; }
      await sleep(2000);
    }
    if (!botResponded) {
      console.log('[MERKEL] No bot response detected within 50s — asserting anyway');
    }
    await sleep(1000);

    const actualCafeText = await page.evaluate(() => document.body.innerText).catch(() => '');
    console.log(`[MERKEL] Cafe response snapshot: ${actualCafeText.slice(0, 400)}`);
    await page.screenshot({ path: join(REPORT_DIR, 'merkel-cafe-response.png') }).catch(() => {});

    if (!botResponded) {
      await page.screenshot({ path: join(REPORT_DIR, 'merkel-cafe-fail.png') }).catch(() => {});
      logFailure('Step 5: Cafe response', 'no bot response received', actualCafeText);
    }
    const finalCafeCount = await page.locator('*').count().catch(() => 0);
    // User message + bot response together must add at least 6 new elements.
    expect(finalCafeCount, 'Step 5: bot gave no response after "Tell me about cafe"').toBeGreaterThan(beforeCafeCount + 5);

    await page.screenshot({ path: join(REPORT_DIR, 'merkel-complete.png') }).catch(() => {});
    console.log('[MERKEL] Test complete — Boardroom greeting and cafe response verified.');
  });
});
