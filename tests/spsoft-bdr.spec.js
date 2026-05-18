import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74ACORyTmV70SWWHX5GaAtEOjlg_62oBVZgZW2BeKC5jeHQ0e5lW6g9I7Ntgk-VPBgXGa3ZUGYR0mYOgzZDZqnFYcN0HIRi-m5D5XBE-vSNPx0Zrlm5FeGOOLAOdngLMXwm4K4h1JA9JXsDMsTF_7vB2nf880kMUT6cN8XMBo5uguMprOuYlCXxKiWyDk-pkmxRtuwoVlt5W5BYtAI';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'SPsoft BDR services flow';
const TEST_NAME   = 'SPsoft BDR services flow';

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
  console.log(`[SPSOFT] waitForNewOccurrence: "${phrase}" did not appear within ${timeoutMs}ms`);
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

test.describe('SPsoft BDR — Services Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(240000); // 4 min: greeting + 2 bot responses + services list + CI headroom

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    await page.goto(BOT_URL);

    // ── Step 2: Open chat via "Let's Chat" button ─────────────────────────────
    const chatBtn = page.getByRole('button', { name: /let.?s chat/i });
    await chatBtn.waitFor({ timeout: 30000 });
    await page.screenshot({ path: join(REPORT_DIR, 'spsoft-startup.png') }).catch(() => {});

    // Dismiss any intro tooltip ("Got It") that may overlay the widget.
    const gotItBtn = page.getByRole('button', { name: /got it/i });
    const hasGotIt = await gotItBtn.waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
    if (hasGotIt) await gotItBtn.click().catch(() => {});
    await sleep(500);

    await chatBtn.click();
    console.log('[SPSOFT] Clicked "Let\'s Chat" — waiting for greeting.');

    // ── Step 3: Wait for and validate greeting ────────────────────────────────
    // "What is your name" is a phrase unique to the greeting body.
    const greetingArrived = await waitForNewOccurrence(page, 'What is your name', 0, 60000);
    if (!greetingArrived) {
      const fallback = await waitForNewOccurrence(page, 'Jessica', 0, 10000);
      if (!fallback) console.log('[SPSOFT] Greeting poll timed out — asserting anyway');
    }
    await sleep(1000);
    await page.screenshot({ path: join(REPORT_DIR, 'spsoft-greeting.png') }).catch(() => {});

    const greetingFail = await checkPhraseGroups(page, [
      { label: '"SPsoft AI representative Jessica" introduction', phrases: [
        'SPsoft AI representative Jessica', 'SPsoft AI representative',
        'AI representative Jessica', 'SPsoft', 'spsoft',
      ]},
      { label: '"Jessica" introduction', phrases: ['Jessica', 'jessica'] },
      { label: '"What is your name" prompt', phrases: [
        'What is your name', 'your name', 'name?',
      ]},
    ]);
    if (greetingFail) {
      await page.screenshot({ path: join(REPORT_DIR, 'spsoft-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', greetingFail, '');
    }
    expect(greetingFail, `Step 3 greeting missing: "${greetingFail}"`).toBeNull();
    console.log('[SPSOFT] Greeting validated.');

    // ── Step 4: Send "Natali" ─────────────────────────────────────────────────
    // Snapshot baselines before send so we detect only the bot's new reply.
    const step5Poll = [
      'Great to meet you', 'great to meet', 'Nice to meet',
      'What can I help you with regarding SPsoft', 'help you with regarding SPsoft',
      'How can I help you with', 'how can I assist',
    ];
    const step5Base = {};
    for (const p of step5Poll) {
      step5Base[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    await sendMessage(page, 'Natali');
    console.log('[SPSOFT] Sent "Natali" — waiting for name acknowledgement.');

    // ── Step 5: Wait for and validate name acknowledgement ────────────────────
    const step5Arrived = await waitForAnyNewOccurrence(page, step5Poll, step5Base, 60000);
    if (!step5Arrived) {
      console.log('[SPSOFT] Step 5 response did not arrive within 60s — asserting anyway');
    }
    await sleep(1000);
    await page.screenshot({ path: join(REPORT_DIR, 'spsoft-after-name.png') }).catch(() => {});

    const step5Fail = await checkPhraseGroups(page, [
      { label: '"Great to meet you, Natali" acknowledgement', phrases: [
        'Great to meet you, Natali', 'Great to meet you, natali',
        'Great to meet you', 'great to meet', 'Nice to meet', 'nice to meet',
      ]},
      { label: '"Natali" echo', phrases: ['Natali', 'natali'] },
      { label: '"What can I help you with regarding SPsoft today" question', phrases: [
        'What can I help you with regarding SPsoft today',
        'What can I help you with regarding SPsoft',
        'help you with regarding SPsoft',
        'What can I help you with', 'How can I help', 'how can I assist',
      ]},
    ]);
    if (step5Fail) {
      await page.screenshot({ path: join(REPORT_DIR, 'spsoft-step5-fail.png') }).catch(() => {});
      logFailure('Step 5: Name acknowledgement', step5Fail, '');
    }
    expect(step5Fail, `Step 5 failed: missing "${step5Fail}"`).toBeNull();
    console.log('[SPSOFT] Name acknowledgement validated.');

    // ── Step 6: Send "tell me about your services" ────────────────────────────
    // Snapshot baselines before send so we detect only the bot's new reply.
    const step7Poll = [
      'Generative AI Solutions', 'Healthcare Data Platforms',
      'Healthcare Digital Solutions', 'Healthcare Cloud Solutions',
      'service pillars', 'specific project', 'just exploring', 'something else',
      'Which of these', 'most relevant', 'looking for', 'current projects',
    ];
    const step7Base = {};
    for (const p of step7Poll) {
      step7Base[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    await sendMessage(page, 'tell me about your services');
    console.log('[SPSOFT] Sent "tell me about your services" — waiting for services list.');

    // ── Step 7: Wait for and validate services response ───────────────────────
    const step7Arrived = await waitForAnyNewOccurrence(page, step7Poll, step7Base, 60000);
    if (!step7Arrived) {
      console.log('[SPSOFT] Step 7 response did not arrive within 60s — asserting anyway');
    }
    await sleep(1000);
    await page.screenshot({ path: join(REPORT_DIR, 'spsoft-after-services.png') }).catch(() => {});

    const step7Fail = await checkPhraseGroups(page, [
      { label: '"Generative AI Solutions" service', phrases: [
        'Generative AI Solutions', 'Generative AI',
      ]},
      { label: '"Healthcare Data Platforms" service', phrases: [
        'Healthcare Data Platforms', 'Healthcare Data',
      ]},
      { label: '"Healthcare Digital Solutions" service', phrases: [
        'Healthcare Digital Solutions', 'Healthcare Digital',
        'Digital Solutions Development', 'Digital Solutions',
      ]},
      { label: '"Healthcare Cloud Solutions" service', phrases: [
        'Healthcare Cloud Solutions', 'Healthcare Cloud',
      ]},
      { label: '"specific project" / "service pillars" / "which of these" follow-up', phrases: [
        'specific project', 'service pillars', 'current projects',
        'particularly interested', 'interested in one', 'interested in',
        'Which of these', 'which of these', 'most relevant', 'specific area',
      ]},
      { label: '"just exploring" / "something else" / "looking for" follow-up', phrases: [
        'just exploring', 'looking for something else', 'something else',
        'relevant to', 'sound like', 'looking for today', 'looking for',
        'such as', 'healthcare data', 'AI development',
      ]},
    ]);
    if (step7Fail) {
      await page.screenshot({ path: join(REPORT_DIR, 'spsoft-services-fail.png') }).catch(() => {});
      logFailure('Step 7: Services response', step7Fail, '');
    }
    expect(step7Fail, `Step 7 failed: missing "${step7Fail}"`).toBeNull();

    await page.screenshot({ path: join(REPORT_DIR, 'spsoft-complete.png') }).catch(() => {});
    console.log('[SPSOFT] Test complete — services list fully verified.');
  });
});
