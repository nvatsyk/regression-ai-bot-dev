import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AmBQhSeflnMr2okssO_yM0BaIdHLA_ltRC6wAs7ZcAkq0MKGT2-GHo2UlmZ5rzshsm-BTJXfxo7VmQ5lFSLcsQZshM5Q4bJiOg1BM322ogCNy0Tf-dGS4ZuVWhDviwDrY4S3E8JmAu4ZQQ_aU7A3IEBf_7wZr3_HPJzFE-XDemFkDR2dbciXbkjRKVWyLEj1NpjSWNanV4XnPsgVHVdEK';

const REPORT_DIR = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');

const BUG_TITLE = 'Repeated onboarding after completed onboarding';
const BUG_DESCRIPTION =
  'After completing onboarding 100%, closing the widget, waiting 2 minutes, and reopening Text Chat, ' +
  'the bot asks the user to complete onboarding again instead of continuing as Zenn mental health coach.';

const FAIL_PHRASES = [
  'please finish the onboarding first',
  'finish the onboarding',
  'Once you are finished, we will switch to voice',
  'To help you get started',
];

// Node.js-level sleep — survives even when the browser page is closed.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function csvEscape(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function logFailure(testName, bugTitle, failedPhrase, actualText) {
  mkdirSync(REPORT_DIR, { recursive: true });
  const row = [
    new Date().toISOString(),
    testName,
    bugTitle,
    failedPhrase,
    actualText.slice(0, 400),
  ]
    .map(csvEscape)
    .join(',') + '\n';
  appendFileSync(REPORT_PATH, row);
}

async function collectPageText(page) {
  return page.evaluate(() => {
    function collectText(root) {
      let text = '';
      for (const node of root.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) text += node.textContent + ' ';
        else if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.shadowRoot) text += collectText(node.shadowRoot);
          text += collectText(node);
        }
      }
      return text;
    }
    return collectText(document.body);
  });
}

// Wait for text matching regex using Playwright's built-in locator, which
// pierces closed shadow DOM (unlike page.evaluate traversal).
async function waitForBotText(page, regex, timeoutMs = 60000) {
  await page.getByText(regex).first().waitFor({ timeout: timeoutMs });
}

// Fill textbox, try Enter, fall back to clicking the Send button.
async function sendMessage(page, text) {
  const input = page.getByRole('textbox');
  await input.waitFor({ timeout: 10000 });
  await input.fill(text);
  await input.press('Enter');
  await sleep(500);
  const stillFilled = await input.inputValue().catch(() => '');
  if (stillFilled.trim() === text.trim()) {
    await page.getByRole('button').last().click();
  }
  await sleep(8000);
}

// Wait for visible element and click it. Throws (with screenshot) if not found.
async function clickButton(page, name, screenshotLabel, exact = true) {
  const btn = page.getByText(name, { exact }).last();
  try {
    await btn.waitFor({ timeout: 30000 });
  } catch (e) {
    mkdirSync(REPORT_DIR, { recursive: true });
    await page.screenshot({
      path: join(
        REPORT_DIR,
        `bfl2-missing-${(screenshotLabel ?? name).replace(/[^a-z0-9]/gi, '_').slice(0, 40)}.png`
      ),
    });
    throw e;
  }
  await btn.click();
  await sleep(10000);
}

// Like clickButton but silently skips if the button never appears within `ms` ms.
async function tryClickButton(page, name, exact = true, ms = 15000) {
  const btn = page.getByText(name, { exact }).last();
  const appeared = await btn.waitFor({ timeout: ms }).then(() => true).catch(() => false);
  if (!appeared) return false;
  await btn.click();
  await sleep(8000);
  return true;
}

// Check page for any fail phrase; returns the matched phrase or null.
async function detectFailPhrase(page) {
  for (const phrase of FAIL_PHRASES) {
    if ((await page.getByText(phrase, { exact: false }).count()) > 0) return phrase;
  }
  return null;
}

test.describe('BFL - Onboarding Persistence Regression', () => {
  test('BFL_2 onboarding persistence after 2 minutes', async ({ page, context }) => {
    // 12 min: onboarding (~5 min) + 2 min sleep + reopen + buffer
    test.setTimeout(720000);
    const testName = 'BFL_2 onboarding persistence after 2 minutes';

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Open bot URL ──────────────────────────────────────────────────
    await page.goto(BOT_URL);

    await page.waitForFunction(
      () => {
        function findText(root, needle) {
          for (const node of root.querySelectorAll('*')) {
            if (node.shadowRoot && findText(node.shadowRoot, needle)) return true;
            if (node.textContent && node.textContent.trim() === needle) return true;
          }
          return false;
        }
        return findText(document, 'Text Chat');
      },
      { timeout: 60000 }
    );
    await page.screenshot({ path: join(REPORT_DIR, 'bfl2-startup.png') });

    // ── Step 2: Click Text Chat ───────────────────────────────────────────────
    await page.getByText('Text Chat').first().click();

    // ── Step 3: Wait for greeting from Zenn ──────────────────────────────────
    // Wait for the chat input to appear, then give the greeting time to render.
    const input = page.getByRole('textbox');
    await input.waitFor({ timeout: 15000 });
    await sleep(6000);

    // ── Step 4: Send "good" ───────────────────────────────────────────────────
    await sendMessage(page, 'good');

    // ── Step 5 / 6: Send "start" after onboarding instruction ────────────────
    await sendMessage(page, 'start');

    // ── Step 7: Complete onboarding 100% ─────────────────────────────────────
    await sendMessage(page, 'Kate');

    // "Good Spouse/Partner" is a chip — click adds it to input; Send submits it.
    await tryClickButton(page, 'Good Spouse/Partner');
    await page.getByRole('button').last().click();
    await sleep(10000);
    await page.screenshot({ path: join(REPORT_DIR, 'bfl2-after-values.png') });

    await tryClickButton(page, '0) Not at all.',        true);  // PHQ Q1
    await tryClickButton(page, '0) Not at all.',        true);  // PHQ Q2
    await tryClickButton(page, '1) Several days.',      true);  // PHQ Q3
    await tryClickButton(page, '3) Nearly every day.',  true);  // PHQ Q4
    await tryClickButton(page, 'Yes',                   true);
    await sendMessage(page, 'skip');                             // phone-number step
    await tryClickButton(page, 'Yes',                   true);
    await tryClickButton(page, 'A) Excellent / Always.', true);
    await tryClickButton(page, 'Yes',                   true);
    await tryClickButton(page, 'Yes',                   true);
    await tryClickButton(page, 'Yes',                   true);
    await tryClickButton(page, 'A) Excellent.',         true);
    await tryClickButton(page, 'A) Excellent.',         true);
    await tryClickButton(page, 'A) Excellent / Always.', true);
    await tryClickButton(page, 'B) Good.',              true);
    await tryClickButton(page, 'A) Excellent.',         true);

    await page.screenshot({ path: join(REPORT_DIR, 'bfl2-onboarding-progress.png') }).catch(() => {});

    // ── Step 8: Wait until 100% or the final onboarding question ─────────────
    await Promise.race([
      waitForBotText(page, /100\s*%/, 120000),
      waitForBotText(page, /feel like doing again/i, 120000),
    ]);
    await page.screenshot({ path: join(REPORT_DIR, 'bfl2-onboarding-complete.png') }).catch(() => {});

    // ── Step 9: Close the widget ──────────────────────────────────────────────
    // Step 10 implicit: we do NOT call page.reload() at any point.
    await page.screenshot({ path: join(REPORT_DIR, 'bfl2-before-close.png') }).catch(() => {});

    // Helper: true when the chat textbox is gone (widget collapsed).
    // Uses Playwright's locator which pierces closed shadow DOM — unlike
    // page.evaluate/querySelectorAll which cannot see closed shadow roots.
    const widgetClosed = async () => {
      const count = await page.getByRole('textbox').count().catch(() => 0);
      return count === 0;
    };

    // 1) Escape key — many widgets honour it.
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(1500);

    if (!page.isClosed() && !(await widgetClosed())) {
      // 2) Coordinate sweep.  The × button sits at ~(1249,216) headless and
      //    ~(1233,217) headed depending on rendering; try both ranges.
      const closeCandidates = [
        [1249, 216], [1250, 215], [1248, 217], [1251, 216], [1246, 216],
        [1233, 217], [1236, 220], [1230, 214], [1233, 211], [1224, 217],
        [1242, 216], [1255, 216],
      ];
      for (const [cx, cy] of closeCandidates) {
        if (page.isClosed()) break;
        await page.mouse.click(cx, cy).catch(() => {});
        await sleep(1500);
        if (page.isClosed() || await widgetClosed()) break;
      }
    }

    await page.screenshot({ path: join(REPORT_DIR, 'bfl2-after-close.png') }).catch(() => {});

    // ── Step 11: Wait 2 minutes (Node.js sleep, browser not reloaded) ─────────
    await sleep(120000);

    // ── Step 12: Click Text Chat again ────────────────────────────────────────
    // Handle the edge-case where the widget's close button called window.close().
    let activePage = page;
    if (page.isClosed()) {
      activePage = await context.newPage();
      await activePage.goto(BOT_URL);
      await activePage.waitForFunction(
        () => {
          function findText(root, needle) {
            for (const node of root.querySelectorAll('*')) {
              if (node.shadowRoot && findText(node.shadowRoot, needle)) return true;
              if (node.textContent && node.textContent.trim() === needle) return true;
            }
            return false;
          }
          return findText(document, 'Text Chat');
        },
        { timeout: 60000 }
      );
    }

    const textChatBtn = activePage.getByText('Text Chat').first();
    await textChatBtn.waitFor({ timeout: 60000 });
    await textChatBtn.click();

    // ── Step 13: Wait for bot response ────────────────────────────────────────
    // Wait for the greeting to land; silently continue on timeout so assertions
    // below produce the meaningful failure message.
    await waitForBotText(activePage, /Hi Kate/i, 45000).catch(() => {});
    await activePage.screenshot({ path: join(REPORT_DIR, 'bfl2-after-reopen.png') }).catch(() => {});

    // ── Step 14: Validate no repeated onboarding, correct greeting ────────────
    let failMatch = await detectFailPhrase(activePage);
    const hasHiKate   = (await activePage.getByText('Hi Kate',                        { exact: false }).count()) > 0;
    const hasCoach    = (await activePage.getByText('digital mental health coach',     { exact: false }).count()) > 0;
    const hasFeeling  = (await activePage.getByText('How are you feeling today',       { exact: false }).count()) > 0;

    if (failMatch || !hasHiKate || !hasCoach || !hasFeeling) {
      await activePage.screenshot({ path: join(REPORT_DIR, 'bfl2-reopen-fail.png') });
      const pageText = await collectPageText(activePage);
      const reason = failMatch
        ? `Fail phrase on reopen: "${failMatch}"`
        : `Expected phrases missing — "Hi Kate": ${hasHiKate}, "digital mental health coach": ${hasCoach}, "How are you feeling today": ${hasFeeling}`;
      logFailure(testName, BUG_TITLE, failMatch ?? reason, pageText);
    }

    expect(failMatch,  `Bug: ${BUG_TITLE}\n${BUG_DESCRIPTION}\nFail phrase: "${failMatch}"`).toBeNull();
    expect(hasHiKate,  'Expected "Hi Kate" in bot response after reopening widget').toBe(true);
    expect(hasCoach,   'Expected "digital mental health coach" in bot response after reopening widget').toBe(true);
    expect(hasFeeling, 'Expected "How are you feeling today" in bot response after reopening widget').toBe(true);

    // ── Step 15: Send "good" ──────────────────────────────────────────────────
    await sendMessage(activePage, 'good');
    await activePage.screenshot({ path: join(REPORT_DIR, 'bfl2-after-good.png') }).catch(() => {});

    // ── Step 16: Validate no onboarding regression after "good" ─────────────
    // Exact coaching wording varies by LLM run — the only hard failure is an
    // onboarding phrase appearing in a session where onboarding was already done.
    failMatch = await detectFailPhrase(activePage);

    if (failMatch) {
      await activePage.screenshot({ path: join(REPORT_DIR, 'bfl2-good-response-fail.png') });
      const pageText = await collectPageText(activePage);
      logFailure(testName, BUG_TITLE, `Fail phrase after "good": "${failMatch}"`, pageText);
    }

    expect(failMatch, `Bug: ${BUG_TITLE}\n${BUG_DESCRIPTION}\nFail phrase after "good": "${failMatch}"`).toBeNull();
  });
});
