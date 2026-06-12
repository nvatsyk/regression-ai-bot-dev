import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL = 'https://bit.ly/Vodafone-AI-Demo';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'vodafone-assistant-fail-report.csv');
const TEST_NAME   = 'Vodafone Cook Islands — Moana AI — Greeting and Services Flow';

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

test.describe('Vodafone Cook Islands — Moana AI — Regression', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ───────────────────────────────────────────────────────
    console.log('[VODAFONE] Navigating to bot URL...');
    await page.goto(BOT_URL);

    // ── Step 2: Click "TEXT CHAT" button ──────────────────────────────────────
    const chatButton = page.getByRole('button', { name: /text chat/i });
    await chatButton.waitFor({ timeout: 30000 });
    await page.screenshot({ path: join(REPORT_DIR, 'vodafone-startup.png') }).catch(() => {});
    await chatButton.click();
    console.log('[VODAFONE] Clicked "TEXT CHAT" button');

    const input = page.getByRole('textbox');
    await input.waitFor({ timeout: 30000 });

    console.log('[VODAFONE] Waiting for greeting to load...');
    await sleep(8000);
    await page.screenshot({ path: join(REPORT_DIR, 'vodafone-greeting.png') }).catch(() => {});

    // ── Step 3: Validate greeting ──────────────────────────────────────────────
    const greetingFail = await checkPhraseGroups(page, [
      { label: '"Hello! I\'m Moana the Vodafone Cook Islands Digital Assistant"', phrases: [
        "I'm Moana the Vodafone Cook Islands Digital Assistant",
        'Moana the Vodafone Cook Islands',
        'Vodafone Cook Islands Digital Assistant',
        'How can I help you today',
        'Moana',
      ]},
    ]);
    if (greetingFail) {
      await page.screenshot({ path: join(REPORT_DIR, 'vodafone-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', greetingFail, '');
    }
    console.log(`[VODAFONE] ${greetingFail ? '[FAIL]' : '[PASS]'} Greeting validation`);
    expect(greetingFail, `Step 3 greeting missing: "${greetingFail}"`).toBeNull();

    // ── Step 4: Send "Yes" ─────────────────────────────────────────────────────
    const step5Phrases = [
      'Certainly, I can help with Vodafone Cook Islands',
      'Vodafone Cook Islands products and services',
      'mobile plan, internet, Top Up',
      'mobile plan',
      'Top Up',
      'Vodafone Cook Islands',
    ];
    const step5Base = {};
    for (const p of step5Phrases) {
      step5Base[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    console.log('[VODAFONE] Sending "Yes"...');
    await sendMessage(page, 'Yes');

    // ── Step 5: Validate response to "Yes" ────────────────────────────────────
    const step5Arrived = await waitForAnyNewOccurrence(page, step5Phrases, step5Base, 45000);
    if (!step5Arrived) console.log('[VODAFONE] Step 5 response did not arrive within 45s — asserting anyway');
    await sleep(1000);
    await page.screenshot({ path: join(REPORT_DIR, 'vodafone-after-yes.png') }).catch(() => {});

    const step5Fail = await checkPhraseGroups(page, [
      { label: '"Certainly, I can help with Vodafone Cook Islands products and services"', phrases: [
        'Certainly, I can help with Vodafone Cook Islands',
        'Vodafone Cook Islands products and services',
        'mobile plan, internet, Top Up',
        'mobile plan',
        'Top Up',
        'Vodafone Cook Islands',
      ]},
    ]);
    if (step5Fail) {
      await page.screenshot({ path: join(REPORT_DIR, 'vodafone-step5-fail.png') }).catch(() => {});
      logFailure('Step 5: Yes response', step5Fail, '');
    }
    console.log(`[VODAFONE] ${step5Fail ? '[FAIL]' : '[PASS]'} Yes response validation`);
    expect(step5Fail, `Step 5 failed: missing "${step5Fail}"`).toBeNull();

    // ── Step 6: Send "tell me about your services" ─────────────────────────────
    const step7Phrases = [
      'mobile, internet, WiFi',
      'business connectivity',
      'E-Moni Mobile Wallet',
      'Travel SIMs',
    ];
    const step7Base = {};
    for (const p of step7Phrases) {
      step7Base[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    console.log('[VODAFONE] Sending "tell me about your services"...');
    await sendMessage(page, 'tell me about your services');
    await sleep(3000);

    // ── Step 7: Validate services response ────────────────────────────────────
    const step7Arrived = await waitForAnyNewOccurrence(page, step7Phrases, step7Base, 60000);
    if (!step7Arrived) console.log('[VODAFONE] Step 7 response did not arrive within 60s — asserting anyway');
    await sleep(1000);
    await page.screenshot({ path: join(REPORT_DIR, 'vodafone-after-services.png') }).catch(() => {});

    const step7Fail = await checkPhraseGroups(page, [
      { label: '"mobile, internet, WiFi, and business connectivity" mention', phrases: [
        'mobile, internet, WiFi', 'business connectivity',
      ]},
      { label: '"E-Moni Mobile Wallet" mention', phrases: ['E-Moni Mobile Wallet', 'E-Moni'] },
      { label: '"Travel SIMs" mention', phrases: ['Travel SIMs', 'eSIMs'] },
    ]);
    if (step7Fail) {
      await page.screenshot({ path: join(REPORT_DIR, 'vodafone-step7-fail.png') }).catch(() => {});
      logFailure('Step 7: Services response', step7Fail, '');
    }
    console.log(`[VODAFONE] ${step7Fail ? '[FAIL]' : '[PASS]'} Services response validation`);
    expect(step7Fail, `Step 7 failed: missing "${step7Fail}"`).toBeNull();

    await page.screenshot({ path: join(REPORT_DIR, 'vodafone-complete.png') }).catch(() => {});
    console.log('[VODAFONE] All steps passed — Vodafone Cook Islands Moana AI regression complete.');
  });
});
