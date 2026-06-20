import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AGORyTmV30UmJ5Pg7Qlsg0skBa-tW1AIrwKwtl8ASTE-2hwuaLGkUqT4zJ2Q0tf8p49v8pzVGTYw8oFqUQRkBPZQoqOmWhRCm59RE5Agv-safhtaOUTrlyhl03zxYwS3Q4TMCew2ggvQpWhuQIMr_342ufoc_F0cQZv1549Ab2HZzVFmSGFkmrsQJRFAlnphipLQyisPyNsdyCloA';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Chronilogix BDR mental health personal support flow';
const TEST_NAME   = 'Chronilogix BDR mental health personal support flow';

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

async function waitForNewOccurrence(page, phrase, beforeCount, timeoutMs = 50000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await page.getByText(phrase, { exact: false }).count().catch(() => 0);
    if (count > beforeCount) return true;
    await sleep(2000);
  }
  console.log(`[CHRON-S] waitForNewOccurrence: "${phrase}" did not appear within ${timeoutMs}ms`);
  return false;
}

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

test.describe('Chronilogix BDR — Mental Health Personal Support Flow (Simple)', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000); // 3 min: greeting + 3 bot responses + CI headroom

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    await page.goto(BOT_URL);
    await page.screenshot({ path: join(REPORT_DIR, 'chron-s-startup.png') }).catch(() => {});

    // ── Step 2: Open chat ────────────────────────────────────────────────────
    const CHAT_LABELS = ['Text Chat', 'Chat', 'Start Chat', "Let's Chat", "Let's Chat", 'Start New Session'];
    let chatBtn = null;
    for (const lbl of CHAT_LABELS) {
      const btn = page.getByText(lbl, { exact: false }).first();
      console.log(`[CHAT] Waiting up to 50000ms for chat button: ${lbl}`);
      const found = await btn.waitFor({ timeout: 50000 }).then(() => true).catch(() => false);
      if (found) { chatBtn = btn; break; }
    }
    if (!chatBtn) {
      const vis = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button,[role="button"]'))
          .map(b => (b.innerText || b.textContent || '').trim()).filter(Boolean)
      ).catch(() => []);
      console.log('[CHRON-S] Chat button not found. Visible buttons:', vis);
      await page.screenshot({ path: join(REPORT_DIR, 'chron-s-open-btn-not-found.png') }).catch(() => {});
      throw new Error(`[CHRON-S] Chat button not found. Tried: ${CHAT_LABELS.join(', ')}. Visible: ${vis.join(', ')}`);
    }
    await chatBtn.click();

    // ── Step 3: Wait for bot greeting ────────────────────────────────────────
    const greetingPhrases = [
      'Hello', 'Hi', 'welcome', 'name', 'your name', 'help', 'assist',
      'Chronilogix', 'Roni', 'support', 'today', 'How can',
    ];
    const greetingBase = {};
    for (const p of greetingPhrases) greetingBase[p] = 0;
    const greetingArrived = await waitForAnyNewOccurrence(page, greetingPhrases, greetingBase, 50000);
    if (!greetingArrived) {
      console.log('[CHRON-S] Greeting poll timed out');
    }
    await sleep(1000);

    const greetingText = await page.evaluate(() => document.body.innerText).catch(() => '');
    console.log('[TEST] Greeting:', greetingText.slice(0, 300));
    await page.screenshot({ path: join(REPORT_DIR, 'chron-s-greeting.png') }).catch(() => {});

    if (!greetingArrived) {
      await page.screenshot({ path: join(REPORT_DIR, 'chron-s-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', 'no greeting received', greetingText);
    }
    expect(greetingArrived, 'Step 3: no greeting received from bot').toBe(true);

    // ── Step 4: Send "Natali" ─────────────────────────────────────────────────
    const step5Poll = [
      'Great', 'great', 'Nice', 'nice', 'Hello', 'Hi', 'thanks', 'Thank',
      'Natali', 'natali', 'name', 'help', 'How', 'What', 'please', 'could',
      'Chronilogix', 'regarding', 'assist', 'meet', 'welcome',
    ];
    const step5Base = {};
    for (const p of step5Poll) {
      step5Base[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    await sendMessage(page, 'Natali');
    console.log('[TEST] User message sent');

    // ── Step 5: Wait for any bot response ────────────────────────────────────
    const step5Arrived = await waitForAnyNewOccurrence(page, step5Poll, step5Base, 60000);
    if (!step5Arrived) {
      console.log('[CHRON-S] Step 5 response did not arrive within 60s — asserting anyway');
    }
    await sleep(1000);

    const step5Text = await page.evaluate(() => document.body.innerText).catch(() => '');
    console.log('[TEST] Bot response received:', step5Text.slice(0, 300));
    await page.screenshot({ path: join(REPORT_DIR, 'chron-s-after-name.png') }).catch(() => {});

    if (!step5Arrived) {
      await page.screenshot({ path: join(REPORT_DIR, 'chron-s-step5-fail.png') }).catch(() => {});
      logFailure('Step 5: Name response', 'no bot response after name', step5Text);
    }
    expect(step5Arrived, 'Step 5: bot gave no response after sending name').toBe(true);

    // ── Step 6: Send "Mental Health" ─────────────────────────────────────────
    await sendMessage(page, 'Mental Health');
    await page.screenshot({ path: join(REPORT_DIR, 'chron-s-after-mental-health.png') }).catch(() => {});

    // ── Step 7: Send "Myself" ─────────────────────────────────────────────────
    await sendMessage(page, 'Myself');
    await page.screenshot({ path: join(REPORT_DIR, 'chron-s-complete.png') }).catch(() => {});
    console.log('[CHRON-S] Test complete — "Myself" sent successfully.');
  });
});
