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
  'progress is saved automatically',
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

// Poll collectPageText until text grows by at least minNewChars beyond baselineLength.
// More reliable than Playwright locators across headless/headed environments.
async function waitForTextChange(page, baselineLength, timeoutMs = 90000, minNewChars = 30) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await collectPageText(page).catch(() => '');
    if (text.length >= baselineLength + minNewChars) return text;
    await sleep(2000);
  }
  return collectPageText(page).catch(() => '');
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
async function tryClickButton(page, name, exact = true, ms = 30000) {
  const btn = page.getByText(name, { exact }).last();
  const appeared = await btn.waitFor({ timeout: ms }).then(() => true).catch(() => false);
  if (!appeared) return false;
  await btn.click();
  await sleep(8000);
  return true;
}

// Try each label in candidates with a short per-candidate timeout; re-sweep the
// list until groupMs elapses or a button is clicked. Uses { exact: false } so
// shorter fallback labels (e.g. "Not at all") also match prefixed variants
// (e.g. "0) Not at all."). Returns null with a diagnostic log + screenshot if
// nothing matched — the bot may have skipped the question; the real regression
// gate is the FAIL_PHRASES check after reopen.
async function clickAnyButton(page, candidates, { groupMs = 30000, candidateMs = 3000, screenshotLabel = null } = {}) {
  const deadline = Date.now() + groupMs;
  while (Date.now() < deadline) {
    for (const label of candidates) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const btn = page.getByText(label, { exact: false }).last();
      const found = await btn
        .waitFor({ timeout: Math.min(candidateMs, remaining) })
        .then(() => true)
        .catch(() => false);
      if (found) {
        await btn.click();
        await sleep(8000);
        return label;
      }
    }
  }
  // Nothing matched — log diagnostics and silently continue.
  const tag = screenshotLabel ?? candidates[0];
  mkdirSync(REPORT_DIR, { recursive: true });
  const pageText = await collectPageText(page).catch(() => '');
  console.log(
    `[BFL_2] clickAnyButton: none of [${candidates.join(' | ')}] appeared within ${groupMs}ms.\n` +
    `Page text (first 800 chars):\n${pageText.slice(0, 800)}`
  );
  await page.screenshot({
    path: join(REPORT_DIR, `bfl2-missing-btn-${tag.replace(/[^a-z0-9]/gi, '_').slice(0, 40)}.png`)
  }).catch(() => {});
  return null;
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
    // 13 min: onboarding (~5 min) + 2 min sleep + reopen + CI buffer
    test.setTimeout(780000);
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

    // "Good Spouse/Partner" is a chip — click adds it to input; Enter/Send submits it.
    // Try flexible label variants in case the bot renders the chip without a prefix.
    await clickAnyButton(page, ['Good Spouse/Partner', 'Spouse/Partner', 'Good Partner']);
    // Press Enter first (works in headless); click Send only if Enter didn't clear the input.
    await page.getByRole('textbox').press('Enter').catch(() => {});
    await sleep(500);
    const chipValue = (await page.getByRole('textbox').inputValue().catch(() => '')).trim();
    if (chipValue) {
      await page.getByRole('button').last().click({ timeout: 10000 }).catch(() => {});
    }
    await sleep(10000);
    await page.screenshot({ path: join(REPORT_DIR, 'bfl2-after-values.png') });

    // PHQ and follow-up questions — each candidate group covers the full label
    // ("0) Not at all.") and the short variant the bot may render without a prefix.
    await clickAnyButton(page, ['0) Not at all.', 'Not at all.', 'Not at all']);              // PHQ Q1
    await clickAnyButton(page, ['0) Not at all.', 'Not at all.', 'Not at all']);              // PHQ Q2
    await clickAnyButton(page, ['1) Several days.', 'Several days.', 'Several days']);        // PHQ Q3
    await clickAnyButton(page, ['3) Nearly every day.', 'Nearly every day.', 'Nearly every day']); // PHQ Q4
    await clickAnyButton(page, ['Yes', 'Okay', 'OK']);
    await sendMessage(page, 'skip');                                                           // phone-number step
    await clickAnyButton(page, ['Yes', 'Okay', 'OK']);
    await clickAnyButton(page, ['A) Excellent / Always.', 'Excellent / Always.', 'Excellent / Always']);
    await clickAnyButton(page, ['Yes', 'Okay', 'OK']);
    await clickAnyButton(page, ['Yes', 'Okay', 'OK']);
    await clickAnyButton(page, ['Yes', 'Okay', 'OK']);
    await clickAnyButton(page, ['A) Excellent.', 'A) Excellent', 'Excellent.']);
    await clickAnyButton(page, ['A) Excellent.', 'A) Excellent', 'Excellent.']);
    await clickAnyButton(page, ['A) Excellent / Always.', 'Excellent / Always.', 'Excellent / Always']);
    await clickAnyButton(page, ['B) Good.', 'B) Good', 'B) Good / Often.', 'B) Good / Often', 'Good.']);
    await clickAnyButton(page, ['A) Excellent.', 'A) Excellent', 'Excellent.']);

    await page.screenshot({ path: join(REPORT_DIR, 'bfl2-onboarding-progress.png') }).catch(() => {});

    // ── Step 8: Wait until 100% or the final onboarding question ─────────────
    // Poll collectPageText instead of Playwright locators to avoid shadow-DOM
    // timing differences between headless CI and headed local runs.
    const onboardingSignal = await (async () => {
      const deadline = Date.now() + 150000; // 2.5 min
      while (Date.now() < deadline) {
        const t = await collectPageText(page).catch(() => '');
        if (/100\s*%/.test(t)) return '100%';
        if (/feel like doing again/i.test(t)) return 'feel-like';
        await sleep(3000);
      }
      return 'timeout-fallback';
    })();
    console.log('[BFL_2] onboarding completion signal:', onboardingSignal);
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
    const textBeforeReopen = await collectPageText(activePage).catch(() => '');
    await textChatBtn.click();

    // ── Step 13: Wait for bot response ────────────────────────────────────────
    // Accept any response — do not require an exact phrase, which varies by LLM run.
    await waitForTextChange(activePage, textBeforeReopen.length, 90000, 100);
    await activePage.screenshot({ path: join(REPORT_DIR, 'bfl2-after-reopen.png') }).catch(() => {});

    // ── Step 14: Validate no repeated onboarding ─────────────────────────────
    // Accept any normal coaching response; fail only if a forbidden onboarding
    // phrase appears — exact wording of the greeting is not asserted.
    let failMatch = await detectFailPhrase(activePage);

    if (failMatch) {
      await activePage.screenshot({ path: join(REPORT_DIR, 'bfl2-reopen-fail.png') });
      const pageText = await collectPageText(activePage);
      console.log('[BFL_2] Page text at reopen fail (first 2000 chars):\n', pageText.slice(0, 2000));
      logFailure(testName, BUG_TITLE, `Fail phrase on reopen: "${failMatch}"`, pageText);
    }

    expect(failMatch, `Bug: ${BUG_TITLE}\n${BUG_DESCRIPTION}\nFail phrase: "${failMatch}"`).toBeNull();

    // ── Step 15: Send "good" ──────────────────────────────────────────────────
    // Snapshot text before sending so we can isolate only the bot's new reply.
    // Prior session text (onboarding Q&A) may legitimately contain fail phrases
    // and must not cause false failures in this assertion.
    const textBeforeGood = await collectPageText(activePage);
    await sendMessage(activePage, 'good');
    await activePage.screenshot({ path: join(REPORT_DIR, 'bfl2-after-good.png') }).catch(() => {});

    // ── Step 16: Validate no onboarding regression after "good" ─────────────
    // Only examine text that appeared AFTER we sent "good".
    // Coaching wording varies by LLM run — the only hard failure is an
    // onboarding-repeat phrase in the bot's new response.
    const textAfterGood = await collectPageText(activePage);
    const newTextAfterGood = textAfterGood.slice(textBeforeGood.length).toLowerCase();
    failMatch = null;
    for (const phrase of FAIL_PHRASES) {
      if (newTextAfterGood.includes(phrase.toLowerCase())) {
        failMatch = phrase;
        break;
      }
    }

    if (failMatch) {
      await activePage.screenshot({ path: join(REPORT_DIR, 'bfl2-good-response-fail.png') });
      const pageText = await collectPageText(activePage);
      console.log('[BFL_2] New text after "good" (first 1000 chars):\n', newTextAfterGood.slice(0, 1000));
      console.log('[BFL_2] Page text at good-response fail (first 2000 chars):\n', pageText.slice(0, 2000));
      logFailure(testName, BUG_TITLE, `Fail phrase after "good": "${failMatch}"`, pageText);
    }

    expect(failMatch, `Bug: ${BUG_TITLE}\n${BUG_DESCRIPTION}\nFail phrase after "good": "${failMatch}"`).toBeNull();
  });
});
