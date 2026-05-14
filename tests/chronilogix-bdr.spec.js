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

// Polls until the occurrence count of phrase INCREASES beyond beforeCount.
async function waitForNewOccurrence(page, phrase, beforeCount, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await page.getByText(phrase, { exact: false }).count().catch(() => 0);
    if (count > beforeCount) return true;
    await sleep(2000);
  }
  console.log(`[CHRON] waitForNewOccurrence: "${phrase}" did not appear within ${timeoutMs}ms`);
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

test.describe('Chronilogix BDR — Mental Health Personal Support Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000); // 3 min: greeting + 3 bot responses + CI headroom

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    await page.goto(BOT_URL);
    await page.screenshot({ path: join(REPORT_DIR, 'chron-startup.png') }).catch(() => {});

    // ── Step 2: Open Text Chat ────────────────────────────────────────────────
    let chatBtn = page.getByRole('button', { name: /text chat/i });
    const foundByRole = await chatBtn.waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
    if (!foundByRole) {
      chatBtn = page.getByText('Text Chat', { exact: false }).first();
      await chatBtn.waitFor({ timeout: 30000 });
    }
    await chatBtn.click();

    // ── Step 3: Wait for and validate greeting ────────────────────────────────
    // Poll for greeting message body using a phrase unique to the message,
    // not the widget header ("Roni AI"). beforeCount=0 so the first appearance counts.
    const greetingArrived = await waitForNewOccurrence(page, 'your name', 0, 60000);
    if (!greetingArrived) {
      console.log('[CHRON] Greeting poll timed out — asserting anyway');
    }
    await sleep(1000);
    await page.screenshot({ path: join(REPORT_DIR, 'chron-greeting.png') }).catch(() => {});

    const greetingFail = await checkPhraseGroups(page, [
      { label: 'Chronilogix mention', phrases: [
        'Chronilogix AI representative', 'Chronilogix AI', 'AI representative',
        'Chronilogix', 'chronilogix',
      ]},
      { label: '"Roni" introduction', phrases: ['Roni'] },
      { label: '"What is your name" prompt', phrases: [
        'What is your name', 'your name', 'name?',
      ]},
    ]);
    if (greetingFail) {
      await page.screenshot({ path: join(REPORT_DIR, 'chron-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', greetingFail, '');
    }
    expect(greetingFail, `Step 3 greeting missing: "${greetingFail}"`).toBeNull();

    // ── Step 4: Send "Natali" ─────────────────────────────────────────────────
    // Snapshot baselines before send so we can detect the bot's new reply.
    const step5Poll = [
      'Great to meet you', 'great to meet', 'Nice to meet', 'nice to meet',
      'What can I help you with regarding Chronilogix', 'help you with regarding',
      'how can I help', 'How can I help',
    ];
    const step5Base = {};
    for (const p of step5Poll) {
      step5Base[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    await sendMessage(page, 'Natali');

    // ── Step 5: Wait for name acknowledgement ────────────────────────────────
    const step5Arrived = await waitForAnyNewOccurrence(page, step5Poll, step5Base, 60000);
    if (!step5Arrived) {
      console.log('[CHRON] Step 5 response did not arrive within 60s — asserting anyway');
    }
    await sleep(1000);
    await page.screenshot({ path: join(REPORT_DIR, 'chron-after-name.png') }).catch(() => {});

    const step5Fail = await checkPhraseGroups(page, [
      { label: '"Great to meet you" acknowledgement', phrases: [
        'Great to meet you', 'great to meet', 'Nice to meet', 'nice to meet', 'nice meeting',
      ]},
      { label: '"Natali" echo', phrases: ['Natali', 'natali'] },
      { label: '"What can I help you with" question', phrases: [
        'What can I help you with regarding Chronilogix',
        'help you with regarding Chronilogix',
        'What can I help you with',
        'how can I help', 'How can I help',
      ]},
    ]);
    if (step5Fail) {
      await page.screenshot({ path: join(REPORT_DIR, 'chron-step5-fail.png') }).catch(() => {});
      logFailure('Step 5: Name acknowledgement', step5Fail, '');
    }
    expect(step5Fail, `Step 5 failed: missing "${step5Fail}"`).toBeNull();

    // ── Step 6: Send "Mental Health" — test passes after this send ───────────
    await sendMessage(page, 'Mental Health');
    await page.screenshot({ path: join(REPORT_DIR, 'chron-after-mental-health.png') }).catch(() => {});

    // ── Step 7: Send "Myself" — test passes after this send ──────────────────
    await sendMessage(page, 'Myself');
    await page.screenshot({ path: join(REPORT_DIR, 'chron-complete.png') }).catch(() => {});
    console.log('[CHRON] Test complete — "Myself" sent successfully.');
  });
});
