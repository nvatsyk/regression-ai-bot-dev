import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AmBQhSeflnMr2okssO_yM0BaIdHLA_ltRC6wAs7ZcAkq0MKGT2-GHo2UlmZ5rzshsm-BTJXfxo7VmQ5lFSLcsQZshM5Q4bJiOg1BM322ogCNy0Tf-dGS4ZuVWhDviwDrY4S3E8JmAu4ZQQ_aU7A3IEBf_7wZr3_HPJzFE-XDemFkDR2dbciXbkjRKVWyLEj1NpjSWNanV4XnPsgVHVdEK';

const REPORT_DIR = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');

// Node.js-level sleep — survives even when the browser page is closed.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function csvEscape(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function logFailure(testName, reason, actualText) {
  mkdirSync(REPORT_DIR, { recursive: true });
  const row = [
    new Date().toISOString(),
    testName,
    reason,
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

// Wait for a visible element and click it.
// exact=true (default) prevents short words like "No" from matching "Not sure".
// exact=false for PHQ buttons: ') Several days.' matches '1) Several days.'.
// Uses .last() to target the current button, not old chat-history text.
async function clickButton(page, name, screenshotLabel, exact = true) {
  const btn = page.getByText(name, { exact }).last();
  try {
    await btn.waitFor({ timeout: 30000 });
  } catch (e) {
    mkdirSync(REPORT_DIR, { recursive: true });
    await page.screenshot({
      path: join(REPORT_DIR, `bfl-missing-${(screenshotLabel ?? name).replace(/[^a-z0-9]/gi, '_').slice(0, 40)}.png`),
    });
    throw e;
  }
  await btn.click();
  await sleep(10000);
}

// Like clickButton but silently skips if the button never appears within `ms` ms.
// The bot's LLM routing sometimes omits steps; this prevents hard failures.
async function tryClickButton(page, name, exact = true, ms = 10000) {
  const btn = page.getByText(name, { exact }).last();
  const appeared = await btn.waitFor({ timeout: ms }).then(() => true).catch(() => false);
  if (!appeared) return false;
  await btn.click();
  await sleep(8000);
  return true;
}

test.describe('BFL - Onboarding Regression', () => {
  test('remembers user after onboarding, close, and reopen', async ({ page, context }) => {
    test.setTimeout(660000); // 11 min — full onboarding + 2 min save wait + buffer
    const testName = 'BFL remembers user after reopen';

    mkdirSync(REPORT_DIR, { recursive: true });
    await page.goto(BOT_URL);

    // Wait for the widget to load and "Text Chat" to appear anywhere in the DOM.
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

    await page.screenshot({ path: join(REPORT_DIR, 'bfl-startup.png') });
    await page.getByText('Text Chat').first().click();

    const input = page.getByRole('textbox');
    await input.waitFor({ timeout: 15000 });
    await sleep(6000);

    // ── Opening messages ──────────────────────────────────────────────────────
    await sendMessage(page, 'good');
    await sendMessage(page, 'start');
    await sendMessage(page, 'Kate');

    // 'Good Spouse/Partner' is a value chip: clicking adds it to the input; Send submits it.
    await tryClickButton(page, 'Good Spouse/Partner');
    await page.getByRole('button').last().click();
    await sleep(10000);
    await page.screenshot({ path: join(REPORT_DIR, 'bfl-after-values.png') });

    // ── Onboarding sequence ────────────────────────────────────────────────────
    // Fixed sequence recorded from a real session. tryClickButton silently skips
    // steps the bot omits due to LLM routing.
    await tryClickButton(page, ') Not at all.',              false);  // PHQ Q1
    await tryClickButton(page, ') Not at all.',              false);  // PHQ Q2
    await tryClickButton(page, ') Several days.',            false);  // PHQ Q3
    await tryClickButton(page, ') Nearly every day.',        false);  // PHQ Q4
    await tryClickButton(page, 'Yes',                        true);
    await sendMessage(page, 'skip');                                   // phone-number step
    await tryClickButton(page, 'Yes',                        true);
    await tryClickButton(page, 'A) Excellent / Always.',     true);
    await tryClickButton(page, 'Yes',                        true);
    await tryClickButton(page, 'Yes',                        true);
    await tryClickButton(page, 'Yes',                        true);
    await tryClickButton(page, 'A) Excellent.',              true);
    await tryClickButton(page, 'A) Excellent.',              true);
    await tryClickButton(page, 'A) Excellent / Always.',     true);
    await tryClickButton(page, 'B) Good.',                   true);
    await tryClickButton(page, 'A) Excellent.',              true);

    await page.screenshot({ path: join(REPORT_DIR, 'bfl-onboarding-complete.png') }).catch(() => {});

    // ── Close the popup ───────────────────────────────────────────────────────
    // The × SVG button lives at ~(1233, 217) confirmed by bfl-debug-point-scan.json.
    // page.mouse.click dispatches real OS-level events through shadow DOM.
    await page.screenshot({ path: join(REPORT_DIR, 'bfl-before-close.png') }).catch(() => {});
    const closeCandidates = [
      [1233, 217], [1230, 214], [1236, 220], [1233, 211], [1224, 217],
    ];
    for (const [cx, cy] of closeCandidates) {
      if (page.isClosed()) break;
      await page.mouse.click(cx, cy).catch(() => {});
      await sleep(2000);
      if (page.isClosed()) break;
      const popupGone = await page.evaluate(() => {
        function hasInput(root) {
          for (const el of root.querySelectorAll('*')) {
            if (el.shadowRoot && hasInput(el.shadowRoot)) return true;
            const role = el.getAttribute && el.getAttribute('role');
            if (
              el.tagName === 'INPUT' ||
              el.tagName === 'TEXTAREA' ||
              role === 'textbox' ||
              (el.tagName === 'DIV' && el.getAttribute('contenteditable') === 'true')
            ) return true;
          }
          return false;
        }
        return !hasInput(document.body);
      }).catch(() => true);
      if (popupGone) break;
    }
    await page.screenshot({ path: join(REPORT_DIR, 'bfl-after-close.png') }).catch(() => {});

    // ── Wait for session to be persisted (2 minutes) ──────────────────────────
    // Node.js sleep — works regardless of whether the browser page is alive.
    await sleep(120000);

    // ── Reopen and verify no onboarding ──────────────────────────────────────
    // If the widget's close button called window.close(), open a fresh page.
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
    await textChatBtn.waitFor({ timeout: 30000 });
    await textChatBtn.click();
    await sleep(15000);
    await sendMessage(activePage, 'good');
    await activePage.screenshot({ path: join(REPORT_DIR, 'bfl-after-reopen.png') });

    const failPhrases = [
      'please finish the onboarding first',
      'once you are finished, we will switch to voice',
      'finish the onboarding',
    ];
    let failMatch = null;
    for (const p of failPhrases) {
      if (await activePage.getByText(p, { exact: false }).count() > 0) {
        failMatch = p;
        break;
      }
    }

    const passName = (await activePage.getByText('Kate', { exact: false }).count()) > 0;
    const passContext =
      (await activePage.getByText('mental health coach', { exact: false }).count()) > 0 ||
      (await activePage.getByText('How are you feeling today', { exact: false }).count()) > 0;

    if (failMatch || !passName || !passContext) {
      await activePage.screenshot({ path: join(REPORT_DIR, 'bfl-reopen-fail.png') });
      const pageText = await collectPageText(activePage);
      const reason = failMatch
        ? `Fail phrase detected: "${failMatch}"`
        : `Pass conditions not met — name found: ${passName}, context found: ${passContext}`;
      logFailure(testName, reason, pageText);
    }

    expect(failMatch, `Fail phrase detected: "${failMatch}"`).toBeNull();
    expect(passName, 'Expected "Kate" in visible text after reopen').toBe(true);
    expect(
      passContext,
      'Expected "mental health coach" or "How are you feeling today" after reopen'
    ).toBe(true);
  });
});
