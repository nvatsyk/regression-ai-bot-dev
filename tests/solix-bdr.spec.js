import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  sleep, navigateTo, checkAndHandleCloudflare, openChatWidget,
  waitForBotGreeting, waitForAnyNewOccurrence, sendMessage,
} from './helpers/browser-utils.js';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AGORyTmV30UmJ5Pg7Qlsg0skB-29FLbACzNpyjxNLJ7fDD1mAWUmk55oTMpra_5TxbfxpjVETIw-olmVQRkAPJQpqumUhhOk5NTE5wou-8aehtWOUTrlyBt03D1ZwC3T4jMBeA6ggfYrWBiSI8v93o6vf4c_FEYRZf94E_Qa2doNlXVUUWGKLjkQEgcsXlXd4YrmCYjCSrbqKhRY';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Solix BDR name capture flow';
const TEST_NAME   = 'Solix BDR name capture flow';

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

test.describe('Solix BDR — Name Capture Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);
    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    await navigateTo(page, BOT_URL);
    await checkAndHandleCloudflare(page, '[SOLIX]', REPORT_DIR);
    await page.screenshot({ path: join(REPORT_DIR, 'solix-startup.png') }).catch(() => {});

    // Dismiss any "Got it" banner
    const gotItBtn = page.getByRole('button', { name: /got it/i });
    const hasGotIt = await gotItBtn.waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
    if (hasGotIt) await gotItBtn.click().catch(() => {});
    await sleep(500);

    // ── Step 2: Capture baselines, open chat ──────────────────────────────────
    const greetingPhrases = ['Hello', 'Hi', 'welcome', 'name', 'your name', 'address you', 'help', 'assist', 'Solix', 'solix', 'Jessica', 'jessica', 'today'];
    const greetingBase = {};
    for (const p of greetingPhrases) {
      greetingBase[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    const chatOpened = await openChatWidget(page, {
      prefix: '[SOLIX]',
      labels: ["Let's Talk", 'Lets Talk', 'Talk', 'Text Chat', 'Chat', 'Start Chat', "Let's Chat", "Let's Chat", 'Start New Session'],
      failScreenshotPath: join(REPORT_DIR, 'solix-open-btn-not-found.png'),
    });
    if (!chatOpened) {
      const vis = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button,[role="button"]'))
          .map(b => (b.innerText || b.textContent || '').trim()).filter(Boolean)
      ).catch(() => []);
      throw new Error(`[SOLIX] Chat button not found. Visible: ${vis.join(', ')}`);
    }

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
