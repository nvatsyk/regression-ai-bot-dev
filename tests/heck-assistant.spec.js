import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL = 'https://sdemo.nextlevel.ai/heck-assistant';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'heck-assistant-fail-report.csv');
const TEST_NAME   = 'Heck Agency Assistant — Greeting and Services Flow';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function csvEscape(v) {
  return `"${String(v).replace(/"/g, '""')}"`;
}

function logFailure(stepLabel, failedPhrase, pageText) {
  mkdirSync(REPORT_DIR, { recursive: true });
  const row = [
    new Date().toISOString(), TEST_NAME, stepLabel, failedPhrase, pageText.slice(0, 400),
  ].map(csvEscape).join(',') + '\n';
  appendFileSync(REPORT_PATH, row);
}

async function sendMessage(page, text) {
  const input = page.getByRole('textbox');
  await input.waitFor({ timeout: 30000 });
  await input.fill(text);
  await input.press('Enter');
  await sleep(500);
  const stillFilled = await input.inputValue().catch(() => '');
  if (stillFilled.trim() === text.trim()) {
    const named = page.getByRole('button', { name: /^send$/i });
    const hasSend = (await named.count().catch(() => 0)) > 0;
    await (hasSend ? named : page.getByRole('button').last()).click().catch(() => {});
  }
}

async function waitForAnyNewOccurrence(page, phrases, baselines, timeoutMs = 45000) {
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

test.describe('Heck Agency Assistant — Regression', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ───────────────────────────────────────────────────────
    console.log('[HECK] Navigating to bot URL...');
    await page.goto(BOT_URL);

    // ── Step 2: Click "Text Chat" button ───────────────────────────────────────
    const chatButton = page.getByRole('button', { name: 'Text Chat' });
    await chatButton.waitFor({ timeout: 15000 });
    await page.screenshot({ path: join(REPORT_DIR, 'heck-startup.png') }).catch(() => {});
    await chatButton.click();
    console.log('[HECK] Clicked "Text Chat" button');

    const input = page.getByRole('textbox');
    await input.waitFor({ timeout: 10000 });

    console.log('[HECK] Waiting for greeting to load...');
    await sleep(8000);
    await page.screenshot({ path: join(REPORT_DIR, 'heck-greeting.png') }).catch(() => {});

    // ── Step 3: Validate greeting ──────────────────────────────────────────────
    // The bot rotates prospect names (Bob, John Smith, Steve Miller, …) but the
    // opening pattern is always "Hey, is this [Name]?" or "Hi, am i speaking with [Name]?"
    const greetingFail = await checkPhraseGroups(page, [
      { label: 'Greeting opener', phrases: [
        'Hey, is this',
        'is this',
        'Hi, am i speaking',
        'am i speaking with',
      ]},
    ]);
    if (greetingFail) {
      await page.screenshot({ path: join(REPORT_DIR, 'heck-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', greetingFail, '');
    }
    console.log(`[HECK] ${greetingFail ? '[FAIL]' : '[PASS]'} Greeting validation`);
    expect(greetingFail, `Step 3 greeting missing: "${greetingFail}"`).toBeNull();

    // ── Step 4: Send "Yes" ─────────────────────────────────────────────────────
    const step5Phrases = [
      'Hey Bob, this is Jessica',
      'this is Jessica',
      'Jessica over at Heck Insurance',
      'Heck Insurance',
      'Jessica',
    ];
    const step5Base = {};
    for (const p of step5Phrases) {
      step5Base[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    console.log('[HECK] Sending "Yes"...');
    await sendMessage(page, 'Yes');

    // ── Step 5: Validate response to "Yes" ────────────────────────────────────
    const step5Arrived = await waitForAnyNewOccurrence(page, step5Phrases, step5Base, 45000);
    if (!step5Arrived) console.log('[HECK] Step 5 response did not arrive within 45s — asserting anyway');
    await sleep(1000);
    await page.screenshot({ path: join(REPORT_DIR, 'heck-after-yes.png') }).catch(() => {});

    const step5Fail = await checkPhraseGroups(page, [
      { label: '"this is Jessica over at Heck Insurance"', phrases: [
        'Hey Bob, this is Jessica',
        'this is Jessica',
        'Jessica over at Heck Insurance',
        'Heck Insurance',
        'Jessica',
      ]},
    ]);
    if (step5Fail) {
      await page.screenshot({ path: join(REPORT_DIR, 'heck-step5-fail.png') }).catch(() => {});
      logFailure('Step 5: Yes response', step5Fail, '');
    }
    console.log(`[HECK] ${step5Fail ? '[FAIL]' : '[PASS]'} Yes response validation`);
    expect(step5Fail, `Step 5 failed: missing "${step5Fail}"`).toBeNull();

    // ── Step 6: Send "tell me about your services" ─────────────────────────────
    const step7Phrases = [
      "I'm calling from Heck Insurance",
      'calling from Heck Insurance',
      'what had you looking around for insurance help?',
      'looking around for insurance help',
      'insurance help',
      'looking around',
      'Heck Insurance',
      'explain the call purpose',
      'quick policy review',
      'licensed Heck Insurance specialist',
      'policy review',
    ];
    const step7Base = {};
    for (const p of step7Phrases) {
      step7Base[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    console.log('[HECK] Sending "tell me about your services"...');
    await sendMessage(page, 'tell me about your services');
    await sleep(3000);

    // ── Step 7: Validate services response ────────────────────────────────────
    const step7Arrived = await waitForAnyNewOccurrence(page, step7Phrases, step7Base, 60000);
    if (!step7Arrived) console.log('[HECK] Step 7 response did not arrive within 60s — asserting anyway');
    await sleep(1000);
    await page.screenshot({ path: join(REPORT_DIR, 'heck-after-services.png') }).catch(() => {});

    const step7Fail = await checkPhraseGroups(page, [
      { label: 'step 7 services response', phrases: [
        "I'm calling from Heck Insurance",
        'calling from Heck Insurance',
        'What had you looking around',
        'had you looking around',
        'looking around for insurance',
        'coverage details',
        'licensed agent',
        'insurance options',
        'can only assist you in English',
        'explain the call purpose',
        'quick policy review',
        'licensed Heck Insurance specialist',
        'policy review',
        'Heck Insurance specialist',
      ]},
    ]);
    if (step7Fail) {
      await page.screenshot({ path: join(REPORT_DIR, 'heck-step7-fail.png') }).catch(() => {});
      logFailure('Step 7: Services response', step7Fail, '');
    }
    console.log(`[HECK] ${step7Fail ? '[FAIL]' : '[PASS]'} Services response validation`);
    expect(step7Fail, `Step 7 failed: missing "${step7Fail}"`).toBeNull();

    await page.screenshot({ path: join(REPORT_DIR, 'heck-complete.png') }).catch(() => {});
    console.log('[HECK] All steps passed — Heck Agency Assistant regression complete.');
  });
});
