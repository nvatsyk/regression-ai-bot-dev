import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AGORyTmV31QhynI7QflIA1MkB-29FLbACzL4F4oGmk9vhh4DSrCTSc-2Jgqb2P2V8G3-kgZqBPGBblsVCwA0jCmquFWAM23NqxpQUvfgbfya1dqB0ypUzWD4-kOAWWOgzIuEaoAqlT4VskIqi_P_dWMZ3-ItxhMKsP2-C_kC2Trxiu0TAhLE1TWBk0HlGlzEwBAuQxBCxqAC1AA';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Famatechnologies BDR name capture flow';
const TEST_NAME   = 'Famatechnologies BDR name capture flow';

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
  console.log(`[FAMA] waitForNewOccurrence: "${phrase}" did not appear within ${timeoutMs}ms`);
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

test.describe('Famatechnologies BDR — Name Capture Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000); // 3 min: widget load + greeting + 1 bot response + CI headroom

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    await page.goto(BOT_URL);

    // This bot auto-opens with a widget that shows "LET'S TALK" and "LET'S CHAT".
    // Wait for "Let's chat" button to become available (it's a plain DOM button, not shadow DOM).
    const chatBtn = page.getByRole('button', { name: /let.?s chat/i });
    await chatBtn.waitFor({ timeout: 30000 });
    await page.screenshot({ path: join(REPORT_DIR, 'fama-startup.png') }).catch(() => {});

    // Dismiss the "Got It" intro tooltip if present — it may overlay the widget.
    const gotItBtn = page.getByRole('button', { name: /got it/i });
    const hasGotIt = await gotItBtn.waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
    if (hasGotIt) await gotItBtn.click().catch(() => {});
    await sleep(500);

    // ── Step 2: Open text chat ────────────────────────────────────────────────
    await chatBtn.click();

    // ── Step 3: Wait for and validate greeting ────────────────────────────────
    // "first and last name" is unique to the greeting message body.
    const greetingArrived = await waitForNewOccurrence(page, 'first and last name', 0, 60000);
    if (!greetingArrived) {
      const fallback = await waitForNewOccurrence(page, 'keyboard', 0, 10000);
      if (!fallback) console.log('[FAMA] Greeting poll timed out — asserting anyway');
    }
    await sleep(1000);
    await page.screenshot({ path: join(REPORT_DIR, 'fama-greeting.png') }).catch(() => {});

    const greetingFail = await checkPhraseGroups(page, [
      { label: 'Famatechnologies mention', phrases: [
        'Famatechnologies AI representative', 'Famatechnologies AI',
        'Famatechnologies', 'famatechnologies',
      ]},
      { label: '"Noura" introduction', phrases: ['Noura', 'noura'] },
      { label: '"first and last name" prompt', phrases: [
        'first and last name', 'first name', 'last name', 'your name',
      ]},
      { label: '"keyboard" instruction', phrases: ['keyboard'] },
    ]);
    if (greetingFail) {
      await page.screenshot({ path: join(REPORT_DIR, 'fama-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', greetingFail, '');
    }
    expect(greetingFail, `Step 3 greeting missing: "${greetingFail}"`).toBeNull();

    // ── Step 4: Send "Natali Test" ────────────────────────────────────────────
    // Snapshot baselines before send so we can detect only the bot's new reply.
    const step5Poll = ['Thank you', 'thank you', 'phone number', 'phone'];
    const step5Base = {};
    for (const p of step5Poll) {
      step5Base[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    await sendMessage(page, 'Natali Test');

    // ── Step 5: Wait for and validate name acknowledgement + phone request ────
    const step5Arrived = await waitForAnyNewOccurrence(page, step5Poll, step5Base, 60000);
    if (!step5Arrived) {
      console.log('[FAMA] Step 5 response did not arrive within 60s — asserting anyway');
    }
    await sleep(1000);
    await page.screenshot({ path: join(REPORT_DIR, 'fama-after-name.png') }).catch(() => {});

    const step5Fail = await checkPhraseGroups(page, [
      { label: '"Thank you" acknowledgement', phrases: [
        'Thank you', 'thank you', 'Thanks', 'thanks',
      ]},
      { label: '"Natali" echo', phrases: ['Natali', 'natali'] },
      { label: '"phone number" request', phrases: [
        'phone number', 'phone', 'mobile number', 'contact number',
      ]},
      { label: '"keyboard" instruction', phrases: ['keyboard'] },
    ]);
    if (step5Fail) {
      await page.screenshot({ path: join(REPORT_DIR, 'fama-step5-fail.png') }).catch(() => {});
      logFailure('Step 5: Name acknowledgement and phone request', step5Fail, '');
    }
    expect(step5Fail, `Step 5 failed: missing "${step5Fail}"`).toBeNull();

    await page.screenshot({ path: join(REPORT_DIR, 'fama-complete.png') }).catch(() => {});
    console.log('[FAMA] Test complete — name capture and phone number request verified.');
  });
});
