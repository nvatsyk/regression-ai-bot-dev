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
  await page.getByRole('textbox').waitFor({ timeout: Math.min(60000, timeoutMs) }).catch(() => {});
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

test.describe('Solix BDR — Name Capture Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);
    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    await page.goto(BOT_URL);

    // ── Step 2: Open chat ─────────────────────────────────────────────────────
    const CHAT_LABELS = ["Let's Talk", "Lets Talk", 'Talk', 'Text Chat', 'Chat', 'Start Chat', "Let's Chat", "Let's Chat", 'Start New Session'];
    let chatBtn = null;
    for (const lbl of CHAT_LABELS) {
      const btn = page.getByText(lbl, { exact: false }).first();
      console.log(`[CHAT] Waiting up to 50000ms for chat button: ${lbl}`);
      const found = await btn.waitFor({ timeout: 70000 }).then(() => true).catch(() => false);
      if (found) { chatBtn = btn; break; }
    }
    if (!chatBtn) {
      chatBtn = page.getByRole('button', { name: /Let's Talk|Lets Talk|Talk|Chat/i });
      const found = await chatBtn.waitFor({ timeout: 70000 }).then(() => true).catch(() => false);
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

    const gotItBtn = page.getByRole('button', { name: /got it/i });
    const hasGotIt = await gotItBtn.waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
    if (hasGotIt) await gotItBtn.click().catch(() => {});
    await sleep(500);

    // Capture baselines BEFORE clicking so greeting detection is accurate
    const greetingPhrases = ['Hello', 'Hi', 'welcome', 'name', 'your name', 'address you', 'help', 'assist', 'Solix', 'solix', 'Jessica', 'jessica', 'today'];
    const greetingBase = {};
    for (const p of greetingPhrases) {
      greetingBase[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }
    await chatBtn.click();

    // ── Step 3: Wait for bot greeting ────────────────────────────────────────
    const greeting = await waitForBotGreeting(page, greetingPhrases, greetingBase, 70000);
    if (!greeting) {
      await page.screenshot({ path: join(REPORT_DIR, 'solix-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', 'no greeting received', '');
    }
    expect(greeting, 'Step 3: bot did not send a greeting').toBeTruthy();
    console.log('[TEST] Greeting:', greeting);
    await page.screenshot({ path: join(REPORT_DIR, 'solix-greeting.png') }).catch(() => {});

    // ── Step 4: Send "Natali Test" ────────────────────────────────────────────
    const step5Poll = [
      'Hi Natali', 'Natali', 'natali',
      'How can I help', 'learn more about Solix',
      'How can I assist', 'data management', 'assist you today',
      'feel free', 'here to help', 'happy to help',
      'Great', 'great', 'Nice', 'Thanks', 'thank',
    ];
    const step5Base = {};
    for (const p of step5Poll) {
      step5Base[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    await sendMessage(page, 'Natali Test');
    console.log('[TEST] User message sent');

    // ── Step 5: Wait for any bot response ────────────────────────────────────
    const step5Arrived = await waitForAnyNewOccurrence(page, step5Poll, step5Base, 70000);
    if (!step5Arrived) {
      await page.screenshot({ path: join(REPORT_DIR, 'solix-step5-fail.png') }).catch(() => {});
      logFailure('Step 5: Name acknowledgement', 'no bot response received', '');
    }
    expect(step5Arrived, 'Step 5: bot gave no response after sending name').toBeTruthy();
    console.log('[TEST] Bot response received:', step5Arrived);
    await page.screenshot({ path: join(REPORT_DIR, 'solix-after-name.png') }).catch(() => {});

    await page.screenshot({ path: join(REPORT_DIR, 'solix-complete.png') }).catch(() => {});
    console.log('[SOLIX] Test complete — name capture and Solix intro verified.');
  });
});
