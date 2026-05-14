import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AGORyTmV30UmJ5Pg7Qlsg0skB-29FLbACzNpyjxNLJ7fDD1mAWUmk55oTMpra_5TxbfxpjVETIw-olmVQRkAPJQpqumUhhOk5NTE5wou-8aehtWOUTrlyBt03D1ZwC3T4jMBeA6ggfYrWBiSI8v93o6vf4c_FEYRZf94E_Qa2doNlXVUUWGKLjkQEgcsXlXd4YrmCYjCSrbqKhRY';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Solix BDR name capture flow';
const TEST_NAME   = 'Solix BDR name capture flow';

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
  console.log(`[SOLIX] waitForNewOccurrence: "${phrase}" did not appear within ${timeoutMs}ms`);
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

test.describe('Solix BDR — Name Capture Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000); // 3 min: widget load + greeting + 1 bot response + CI headroom

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    await page.goto(BOT_URL);

    // ── Step 2: Open chat via "Let's Talk" button ─────────────────────────────
    const chatBtn = page.getByRole('button', { name: /Let's Talk|Lets Talk|Talk/i });
    await chatBtn.waitFor({ timeout: 30000 });
    await page.screenshot({ path: join(REPORT_DIR, 'solix-startup.png') }).catch(() => {});

    // Dismiss any intro tooltip ("Got It") that may overlay the widget.
    const gotItBtn = page.getByRole('button', { name: /got it/i });
    const hasGotIt = await gotItBtn.waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
    if (hasGotIt) await gotItBtn.click().catch(() => {});
    await sleep(500);

    await chatBtn.click();

    // ── Step 3: Wait for and validate greeting ────────────────────────────────
    // "how may I address you" is a phrase unique to the greeting body.
    const greetingArrived = await waitForNewOccurrence(page, 'how may I address you', 0, 60000);
    if (!greetingArrived) {
      // Fall back to polling for the name question phrase.
      const fallback = await waitForNewOccurrence(page, 'What is your name', 0, 10000);
      if (!fallback) console.log('[SOLIX] Greeting poll timed out — asserting anyway');
    }
    await sleep(1000);
    await page.screenshot({ path: join(REPORT_DIR, 'solix-greeting.png') }).catch(() => {});

    const greetingFail = await checkPhraseGroups(page, [
      { label: 'Solix AI representative mention', phrases: [
        'Solix AI representative', 'Solix AI', 'AI representative',
        'Solix', 'solix',
      ]},
      { label: '"Jessica" introduction', phrases: ['Jessica', 'jessica'] },
      { label: '"What is your name" prompt', phrases: [
        'What is your name', 'your name', 'how may I address you', 'address you',
      ]},
    ]);
    if (greetingFail) {
      await page.screenshot({ path: join(REPORT_DIR, 'solix-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', greetingFail, '');
    }
    expect(greetingFail, `Step 3 greeting missing: "${greetingFail}"`).toBeNull();

    // ── Step 4: Send "Natali Test" ────────────────────────────────────────────
    // Snapshot baselines before send so we detect only the bot's new reply.
    const step5Poll = [
      'Hi Natali', 'Natali',
      'How can I help you learn more about Solix', 'learn more about Solix',
      'How can I assist you with Solix', 'data management solutions',
      'assist you with Solix', 'Solix and our services',
      'How can I assist you today', 'How can I help',
    ];
    const step5Base = {};
    for (const p of step5Poll) {
      step5Base[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    await sendMessage(page, 'Natali Test');

    // ── Step 5: Wait for and validate name acknowledgement ────────────────────
    const step5Arrived = await waitForAnyNewOccurrence(page, step5Poll, step5Base, 60000);
    if (!step5Arrived) {
      console.log('[SOLIX] Step 5 response did not arrive within 60s — asserting anyway');
    }
    await sleep(1000);
    await page.screenshot({ path: join(REPORT_DIR, 'solix-after-name.png') }).catch(() => {});

    const step5Fail = await checkPhraseGroups(page, [
      { label: '"Hi Natali" acknowledgement', phrases: [
        'Hi Natali Test', 'Hi Natali', 'Hello Natali', 'Natali',
      ]},
      { label: 'Solix mention', phrases: ['Solix', 'solix'] },
      { label: '"How can I help/assist" prompt', phrases: [
        'How can I help you learn more about Solix',
        'learn more about Solix',
        'How can I assist you with Solix',
        'assist you with Solix',
        'Solix and our services',
        'Solix Technologies',
        'data management solutions',
        'How can I assist you today', 'assist you today',
        'How can I help you today', 'How can I help',
        'How can I assist',
      ]},
    ]);
    if (step5Fail) {
      await page.screenshot({ path: join(REPORT_DIR, 'solix-step5-fail.png') }).catch(() => {});
      logFailure('Step 5: Name acknowledgement', step5Fail, '');
    }
    expect(step5Fail, `Step 5 failed: missing "${step5Fail}"`).toBeNull();

    await page.screenshot({ path: join(REPORT_DIR, 'solix-complete.png') }).catch(() => {});
    console.log('[SOLIX] Test complete — name capture and Solix intro verified.');
  });
});
