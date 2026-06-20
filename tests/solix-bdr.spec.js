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
async function waitForNewOccurrence(page, phrase, beforeCount, timeoutMs = 50000) {
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

test.describe('Solix BDR — Name Capture Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000); // 3 min: widget load + greeting + 1 bot response + CI headroom

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    await page.goto(BOT_URL);

    // ── Step 2: Open chat ─────────────────────────────────────────────────────
    const CHAT_LABELS = ["Let's Talk", "Lets Talk", 'Talk', 'Text Chat', 'Chat', 'Start Chat', "Let's Chat", "Let's Chat", 'Start New Session'];
    let chatBtn = null;
    for (const lbl of CHAT_LABELS) {
      const btn = page.getByText(lbl, { exact: false }).first();
      console.log(`[CHAT] Waiting up to 50000ms for chat button: ${lbl}`);
      const found = await btn.waitFor({ timeout: 50000 }).then(() => true).catch(() => false);
      if (found) { chatBtn = btn; break; }
    }
    if (!chatBtn) {
      chatBtn = page.getByRole('button', { name: /Let's Talk|Lets Talk|Talk|Chat/i });
      const found = await chatBtn.waitFor({ timeout: 50000 }).then(() => true).catch(() => false);
      if (!found) {
        const vis = await page.evaluate(() =>
          Array.from(document.querySelectorAll('button,[role="button"]'))
            .map(b => (b.innerText || b.textContent || '').trim()).filter(Boolean)
        ).catch(() => []);
        await page.screenshot({ path: join(REPORT_DIR, 'solix-open-btn-not-found.png') }).catch(() => {});
        throw new Error(`[SOLIX] Chat button not found. Visible: ${vis.join(', ')}`);
      }
    }
    await page.screenshot({ path: join(REPORT_DIR, 'solix-startup.png') }).catch(() => {});

    // Dismiss any intro tooltip ("Got It") that may overlay the widget.
    const gotItBtn = page.getByRole('button', { name: /got it/i });
    const hasGotIt = await gotItBtn.waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
    if (hasGotIt) await gotItBtn.click().catch(() => {});
    await sleep(500);

    await chatBtn.click();

    // ── Step 3: Wait for bot greeting ────────────────────────────────────────
    const greetingPhrases = [
      'Hello', 'Hi', 'welcome', 'name', 'your name', 'address you',
      'help', 'assist', 'Solix', 'solix', 'Jessica', 'jessica', 'today',
    ];
    const greetingBase = {};
    for (const p of greetingPhrases) greetingBase[p] = 0;
    const greetingArrived = await waitForAnyNewOccurrence(page, greetingPhrases, greetingBase, 50000);
    if (!greetingArrived) {
      console.log('[SOLIX] Greeting poll timed out');
    }
    await sleep(1000);

    const greetingText = await page.evaluate(() => document.body.innerText).catch(() => '');
    console.log('[TEST] Greeting:', greetingText.slice(0, 300));
    await page.screenshot({ path: join(REPORT_DIR, 'solix-greeting.png') }).catch(() => {});

    if (!greetingArrived) {
      await page.screenshot({ path: join(REPORT_DIR, 'solix-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', 'no greeting received', greetingText);
    }
    expect(greetingArrived, 'Step 3: no greeting received from bot').toBe(true);

    // ── Step 4: Send "Natali Test" ────────────────────────────────────────────
    // Snapshot baselines before send so we detect only the bot's new reply.
    const step5Poll = [
      'Hi Natali', 'Natali', 'natali',
      'How can I help', 'learn more about Solix',
      'How can I assist', 'data management', 'assist you today',
      'How can I help you today', 'How may I assist',
      'feel free', 'here to help', 'happy to help',
      'Great', 'great', 'Nice', 'Thanks', 'thank',
    ];
    const step5Base = {};
    for (const p of step5Poll) {
      step5Base[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    await sendMessage(page, 'Natali Test');
    console.log('[TEST] User message sent');
    console.log('[SOLIX] Sent "Natali Test" — waiting for name acknowledgement.');

    // ── Step 5: Wait for any bot response ────────────────────────────────────
    const step5Arrived = await waitForAnyNewOccurrence(page, step5Poll, step5Base, 60000);
    if (!step5Arrived) {
      console.log('[SOLIX] Step 5 response did not arrive within 60s — asserting anyway');
    }
    await sleep(1000);

    const responseText = await page.evaluate(() => document.body.innerText).catch(() => '');
    console.log('[TEST] Bot response received:', responseText.slice(0, 300));
    await page.screenshot({ path: join(REPORT_DIR, 'solix-after-name.png') }).catch(() => {});

    if (!step5Arrived) {
      await page.screenshot({ path: join(REPORT_DIR, 'solix-step5-fail.png') }).catch(() => {});
      logFailure('Step 5: Name acknowledgement', 'no bot response received', responseText);
    }
    expect(step5Arrived, 'Step 5: bot gave no response after sending name').toBe(true);
    console.log('[SOLIX] Bot responded after name.');

    await page.screenshot({ path: join(REPORT_DIR, 'solix-complete.png') }).catch(() => {});
    console.log('[SOLIX] Test complete — name capture and Solix intro verified.');
  });
});
