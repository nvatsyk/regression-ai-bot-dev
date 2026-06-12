import { test, expect } from '@playwright/test';
import { writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const BOT_URL = 'https://sdemo.nextlevel.ai/grameenphone-telenor';
const REPORT_DIR = join(process.cwd(), 'reports');
const SCREENSHOTS_DIR = join(process.cwd(), 'test-results', 'grameenphone');
const REPORT_PATH = join(REPORT_DIR, 'grameenphone-report.csv');

const GREETING_TIMEOUT  = 30000;  // max ms to wait for first bot greeting
const RESPONSE_TIMEOUT  = 30000;  // max ms to wait for bot to finish a reply
const STABLE_CHECKS     = 2;      // consecutive 1-s checks with no text change = "done"
const SILENT_WAIT_MS    = 23000;  // 23 s between silent-trigger checks (3 s buffer)

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Recursively collect all visible text, piercing shadow DOM. */
async function collectPageText(page) {
  return page.evaluate(() => {
    function walk(root) {
      let text = '';
      for (const node of root.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent + ' ';
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.shadowRoot) text += walk(node.shadowRoot);
          text += walk(node);
        }
      }
      return text;
    }
    return walk(document.body);
  });
}

/** Poll until page text stops changing for STABLE_CHECKS × 1 s, or maxWait ms. */
async function waitForBotResponse(page, maxWait = RESPONSE_TIMEOUT) {
  let prev = await collectPageText(page);
  const deadline = Date.now() + maxWait;
  let stable = 0;
  while (Date.now() < deadline) {
    await sleep(1000);
    const cur = await collectPageText(page);
    if (cur === prev) {
      if (++stable >= STABLE_CHECKS) return;
    } else {
      stable = 0;
      prev = cur;
    }
  }
}

/**
 * Open the chat UI if it is behind a trigger button.
 * Falls back gracefully if the textbox is already visible (full-page embed).
 */
async function openChat(page) {
  const input = page.getByRole('textbox');
  if (await input.isVisible().catch(() => false)) return;

  // Try labelled "Text Chat" button first (common NextLevel widget pattern)
  for (const label of ['Text Chat', 'Chat', 'Start Chat', 'Open Chat']) {
    const btn = page.getByText(label, { exact: false }).first();
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click();
      await input.waitFor({ timeout: 30000 }).catch(() => {});
      return;
    }
  }

  // Fall back: click the first visible button and hope it opens the chat
  const anyBtn = page.getByRole('button').first();
  if (await anyBtn.isVisible().catch(() => false)) {
    await anyBtn.click();
    await sleep(2000);
  }
}

/** Type text into the chat input and submit (Enter, with button fallback). */
async function sendMessage(page, text) {
  const input = page.getByRole('textbox');
  await input.waitFor({ timeout: 10000 });
  await input.fill(text);
  await input.press('Enter');
  await sleep(400);
  const still = await input.inputValue().catch(() => '');
  if (still.trim() === text.trim()) {
    // Enter didn't submit — click the Send button
    await page.getByRole('button').last().click();
  }
}

/** Append one failure row to the CSV report. */
function logFailure(step, expectedPhrases, actualText) {
  const esc = v => `"${String(v).replace(/"/g, '""')}"`;
  const row = [
    new Date().toISOString(),
    step,
    expectedPhrases.join(' | '),
    actualText.slice(0, 500),
  ].map(esc).join(',') + '\n';
  appendFileSync(REPORT_PATH, row);
}

/** Structured console helper (visible in Playwright list reporter). */
function logInfo(tag, msg) {
  console.log(`[${tag.toUpperCase()}] ${msg}`);
}

/**
 * Assert at least one of expectedPhrases (treated as case-insensitive RegExp)
 * appears in page text.  Takes a screenshot and logs CSV on failure.
 */
async function assertResponse(page, step, expectedPhrases) {
  const pageText = await collectPageText(page);
  let matchedPhrase = null;
  for (const p of expectedPhrases) {
    if (new RegExp(p, 'i').test(pageText)) { matchedPhrase = p; break; }
  }

  if (!matchedPhrase) {
    logFailure(step, expectedPhrases, pageText);
    const sPath = join(SCREENSHOTS_DIR, `fail-${step.replace(/[^a-z0-9]/gi, '_').slice(0, 60)}-${Date.now()}.png`);
    await page.screenshot({ path: sPath, fullPage: true }).catch(() => {});
    logInfo('FAIL', `"${step}" — none of [${expectedPhrases.join(' | ')}] found`);
    logInfo('FAIL', `Page text snippet: ${pageText.slice(0, 300)}`);
  } else {
    logInfo('PASS', `"${step}" — matched phrase: "${matchedPhrase}"`);
  }

  expect(
    matchedPhrase,
    `[${step}] Expected one of:\n  ${expectedPhrases.join('\n  ')}\n\nPage text (first 400 chars):\n${pageText.slice(0, 400)}`
  ).not.toBeNull();
}

/**
 * Navigate to the bot, open the chat, and wait until the bot sends its
 * greeting — WITHOUT the test having sent any user message first.
 * Throws (fails the test) if the greeting does not appear within GREETING_TIMEOUT.
 */
async function setupAndWaitForGreeting(page) {
  await page.goto(BOT_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(2000);
  await openChat(page);

  logInfo('INFO', 'Waiting for bot greeting (no user message sent yet)…');

  await page.waitForFunction(
    ({ timeout: _t }) => {
      function walk(root) {
        let t = '';
        for (const n of root.childNodes) {
          if (n.nodeType === Node.TEXT_NODE) t += n.textContent + ' ';
          else if (n.nodeType === Node.ELEMENT_NODE) {
            if (n.shadowRoot) t += walk(n.shadowRoot);
            t += walk(n);
          }
        }
        return t;
      }
      const text = walk(document.body).toLowerCase();
      return (
        text.includes('hello') ||
        text.includes('hi') ||
        text.includes('welcome') ||
        text.includes('grameenphone') ||
        text.includes('help you') ||
        text.includes('how can i') ||
        text.includes('how may i')
      );
    },
    {},
    { timeout: GREETING_TIMEOUT }
  );

  logInfo('INFO', 'Bot greeting detected.');
  await sleep(2000); // allow full greeting to render
}

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL HOOKS
// ═══════════════════════════════════════════════════════════════════════════════

test.beforeAll(() => {
  mkdirSync(REPORT_DIR, { recursive: true });
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  writeFileSync(REPORT_PATH, 'timestamp,step,expected_phrases,actual_text\n');
  logInfo('SETUP', `Report: ${REPORT_PATH}`);
  logInfo('SETUP', `Screenshots: ${SCREENSHOTS_DIR}`);
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    const sPath = join(
      SCREENSHOTS_DIR,
      `fail-afterEach-${testInfo.title.replace(/[^a-z0-9]/gi, '_').slice(0, 50)}-${Date.now()}.png`
    );
    await page.screenshot({ path: sPath, fullPage: true }).catch(() => {});
    await testInfo.attach('failure-screenshot', { path: sPath, contentType: 'image/png' }).catch(() => {});
    logInfo('FAIL', `afterEach screenshot: ${sPath}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 01 — GREETING VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('01 - Greeting Validation', () => {
  test('bot greets first — no user message sent beforehand', async ({ page }) => {
    await page.goto(BOT_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await sleep(2000);
    await openChat(page);

    logInfo('INFO', 'No user message will be sent — measuring time to first greeting…');
    const t0 = Date.now();

    let greetingDetected = false;
    let greetingMs = 0;

    try {
      await page.waitForFunction(
        () => {
          function walk(root) {
            let t = '';
            for (const n of root.childNodes) {
              if (n.nodeType === Node.TEXT_NODE) t += n.textContent + ' ';
              else if (n.nodeType === Node.ELEMENT_NODE) {
                if (n.shadowRoot) t += walk(n.shadowRoot);
                t += walk(n);
              }
            }
            return t;
          }
          const text = walk(document.body).toLowerCase();
          return (
            text.includes('hello') || text.includes('hi') ||
            text.includes('welcome') || text.includes('grameenphone') ||
            text.includes('help you') || text.includes('how can i')
          );
        },
        {},
        { timeout: GREETING_TIMEOUT }
      );
      greetingDetected = true;
      greetingMs = Date.now() - t0;
      logInfo('INFO', `Greeting appeared in ${greetingMs} ms`);
    } catch {
      logInfo('FAIL', 'No greeting detected within GREETING_TIMEOUT');
      await page.screenshot({ path: join(SCREENSHOTS_DIR, 'fail-no-greeting.png'), fullPage: true });
    }

    // ASSERTION 1: bot must greet
    expect(greetingDetected, 'Bot must send a greeting before the user sends any message').toBe(true);

    // ASSERTION 2: greeting must arrive within acceptable delay (15 s)
    expect(
      greetingMs,
      `Greeting took ${greetingMs} ms — expected < 15 000 ms`
    ).toBeLessThan(15000);

    // ASSERTION 3: greeting content is natural / Grameenphone-relevant
    await assertResponse(page, 'greeting-content', [
      'hello', 'hi', 'welcome', 'grameenphone', 'help you', 'assist', 'how can i', 'how may i',
    ]);

    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'pass-greeting.png'), fullPage: true });
    logInfo('PASS', `Greeting validated — appeared in ${greetingMs} ms`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 02 — Q&A SCENARIOS (10 user scenarios)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('02 - Q&A Scenarios', () => {
  test('Q01 — 5G service benefits and requirements', async ({ page }) => {
    await setupAndWaitForGreeting(page);
    await sendMessage(page, "What are the benefits of Grameenphone's 5G service, and what do I need to use it?");
    await waitForBotResponse(page);
    await assertResponse(page, 'Q01-5G', [
      '5G', 'speed', 'network', 'device', 'compatible', 'benefit', 'coverage', 'high.speed',
    ]);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'q01-5g.png'), fullPage: true });
  });

  test('Q02 — GPFI wireless broadband plans and devices', async ({ page }) => {
    await setupAndWaitForGreeting(page);
    await sendMessage(page, 'Tell me about GPFI. What kind of internet plans and devices do they offer for wireless broadband?');
    await waitForBotResponse(page);
    await assertResponse(page, 'Q02-GPFI', [
      'GPFI', 'internet', 'broadband', 'plan', 'wireless', 'device', 'data', 'package',
    ]);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'q02-gpfi.png'), fullPage: true });
  });

  test('Q03 — Corporate Messaging / Bulk SMS pricing tiers', async ({ page }) => {
    await setupAndWaitForGreeting(page);
    await sendMessage(page, "How can businesses use Grameenphone's Corporate Messaging (Bulk SMS) service? What are the pricing tiers?");
    await waitForBotResponse(page);
    await assertResponse(page, 'Q03-BulkSMS', [
      'SMS', 'bulk', 'corporate', 'messaging', 'business', 'pricing', 'tier', 'enterprise', 'campaign',
    ]);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'q03-bulk-sms.png'), fullPage: true });
  });

  test('Q04 — GPStar loyalty tiers and discounts', async ({ page }) => {
    await setupAndWaitForGreeting(page);
    await sendMessage(page, "I'm interested in the GPStar loyalty program. What are the membership tiers and what kind of discounts can I get?");
    await waitForBotResponse(page);
    await assertResponse(page, 'Q04-GPStar', [
      'GPStar', 'loyalty', 'tier', 'discount', 'reward', 'membership', 'point', 'benefit',
    ]);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'q04-gpstar.png'), fullPage: true });
  });

  test('Q05 — Grameenphone Accelerator program for startups', async ({ page }) => {
    await setupAndWaitForGreeting(page);
    await sendMessage(page, 'What is the Grameenphone Accelerator program, and what kind of support does it offer to startups?');
    await waitForBotResponse(page);
    await assertResponse(page, 'Q05-Accelerator', [
      'accelerator', 'startup', 'support', 'program', 'innovation', 'entrepreneur', 'incubat', 'grameenphone',
    ]);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'q05-accelerator.png'), fullPage: true });
  });

  test('Q06 — USSD codes for balance check and package cancellation', async ({ page }) => {
    await setupAndWaitForGreeting(page);
    await sendMessage(page, 'Can you tell me how to check my internet balance and how to cancel an internet package using USSD codes?');
    await waitForBotResponse(page);
    await assertResponse(page, 'Q06-USSD', [
      'USSD', '\\*', '#', 'balance', 'cancel', 'package', 'internet', 'code', 'dial',
    ]);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'q06-ussd.png'), fullPage: true });
  });

  test('Q07 — MyGP app features and service management', async ({ page }) => {
    await setupAndWaitForGreeting(page);
    await sendMessage(page, 'What are the main features of the MyGP app, and how does it help manage my Grameenphone services?');
    await waitForBotResponse(page);
    await assertResponse(page, 'Q07-MyGP', [
      'MyGP', 'app', 'feature', 'manage', 'service', 'recharge', 'balance', 'account', 'download',
    ]);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'q07-mygp.png'), fullPage: true });
  });

  test('Q08 — Service center locations and operating hours', async ({ page }) => {
    await setupAndWaitForGreeting(page);
    await sendMessage(page, 'Where can I find a Grameenphone service center, and what are their typical operating hours?');
    await waitForBotResponse(page);
    await assertResponse(page, 'Q08-ServiceCenter', [
      'service center', 'location', 'hour', 'open', 'branch', 'address', 'operating', 'visit',
    ]);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'q08-service-center.png'), fullPage: true });
  });

  test('Q09 — IoT solutions for businesses', async ({ page }) => {
    await setupAndWaitForGreeting(page);
    await sendMessage(page, "What are Grameenphone's IoT solutions for businesses, and what specific problems do they solve?");
    await waitForBotResponse(page);
    await assertResponse(page, 'Q09-IoT', [
      'IoT', 'solution', 'business', 'connect', 'device', 'smart', 'sensor', 'automat', 'track', 'monitor',
    ]);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'q09-iot.png'), fullPage: true });
  });

  test('Q10 — International roaming with prepaid balance', async ({ page }) => {
    await setupAndWaitForGreeting(page);
    await sendMessage(page, 'Does Grameenphone offer international roaming with prepaid balance, and how does that work?');
    await waitForBotResponse(page);
    await assertResponse(page, 'Q10-Roaming', [
      'roaming', 'international', 'prepaid', 'abroad', 'balance', 'activate', 'country', 'charge', 'travel',
    ]);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'q10-roaming.png'), fullPage: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 03 — INBOUND SUPPORT USE CASES
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('03 - Inbound Support Use Cases', () => {
  test('Support — balance and usage inquiry', async ({ page }) => {
    await setupAndWaitForGreeting(page);
    await sendMessage(page, 'I want to check my balance and how much data I have left');
    await waitForBotResponse(page);
    await assertResponse(page, 'support-balance', [
      'balance', 'data', 'check', 'USSD', 'MyGP', 'usage', 'remaining', 'dial',
    ]);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'support-balance.png'), fullPage: true });
  });

  test('Support — internet pack purchase and troubleshooting', async ({ page }) => {
    await setupAndWaitForGreeting(page);
    await sendMessage(page, "I bought an internet pack but it's not working. My data is not connecting even after recharging.");
    await waitForBotResponse(page);
    await assertResponse(page, 'support-internet', [
      'internet', 'data', 'pack', 'troubleshoot', 'restart', 'APN', 'network', 'setting', 'issue', 'help',
    ]);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'support-internet.png'), fullPage: true });
  });

  test('Support — recharge / top-up failure', async ({ page }) => {
    await setupAndWaitForGreeting(page);
    await sendMessage(page, 'My recharge failed but the money was deducted from my bank. What should I do?');
    await waitForBotResponse(page);
    await assertResponse(page, 'support-recharge', [
      'recharge', 'deduct', 'refund', 'bank', 'transaction', 'contact', 'reversal', 'sorry', 'help',
    ]);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'support-recharge.png'), fullPage: true });
  });

  test('Support — unwanted VAS / automatic balance deduction', async ({ page }) => {
    await setupAndWaitForGreeting(page);
    await sendMessage(page, 'My balance keeps getting deducted automatically. I think I have some unwanted VAS services activated. How do I stop this?');
    await waitForBotResponse(page);
    await assertResponse(page, 'support-vas', [
      'VAS', 'value.added', 'deduct', 'unsubscribe', 'cancel', 'stop', 'service', 'deactivat', 'USSD',
    ]);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'support-vas.png'), fullPage: true });
  });

  test('Support — network issue / call drop complaint', async ({ page }) => {
    await setupAndWaitForGreeting(page);
    await sendMessage(page, 'I keep experiencing call drops and very poor network coverage in my area. This has been happening for the past few days.');
    await waitForBotResponse(page);
    await assertResponse(page, 'support-network', [
      'network', 'coverage', 'call drop', 'complaint', 'area', 'report', 'sorry', 'apologize', 'team', 'investigate',
    ]);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'support-network.png'), fullPage: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 04 — SILENT TRIGGER TESTS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('04 - Silent Trigger Tests', () => {
  test('inactivity triggers fire at 20 s, 40 s, 60 s', async ({ page }) => {
    test.setTimeout(300000); // 5 min — covers full 60 s silence + overhead

    await setupAndWaitForGreeting(page);

    // Establish context with one message so the bot has a reference point
    await sendMessage(page, 'Hello, I need help with my Grameenphone account.');
    await waitForBotResponse(page);

    logInfo('INFO', 'Context set. Going silent — tracking inactivity triggers…');

    // ── 20-second trigger ───────────────────────────────────────────────────
    const snapshot0 = await collectPageText(page);
    const t1 = Date.now();
    await sleep(SILENT_WAIT_MS); // 23 s
    const elapsed1 = Date.now() - t1;
    logInfo('TIMER', `20 s window elapsed: ${elapsed1} ms`);

    const text20s = await collectPageText(page);
    const delta20s = text20s.slice(snapshot0.length).toLowerCase();
    logInfo('TRIGGER-20S', `New text: "${delta20s.slice(0, 200)}"`);

    const trigger20Matched = /still there|are you there|still with us|you there|need help|hello\?|hey there/i.test(delta20s);
    if (!trigger20Matched) {
      logFailure('silent-trigger-20s', ['still there', 'are you there', 'still with us'], delta20s);
      await page.screenshot({ path: join(SCREENSHOTS_DIR, 'fail-silent-20s.png'), fullPage: true });
      logInfo('FAIL', '20 s silent trigger — expected re-engagement phrase not found');
    } else {
      logInfo('PASS', '20 s silent trigger matched');
    }
    expect(trigger20Matched, `[silent-trigger-20s] Expected a re-engagement phrase at ~20 s.\nGot: "${delta20s.slice(0, 200)}"`).toBe(true);

    // ── 40-second trigger ───────────────────────────────────────────────────
    const snapshot1 = await collectPageText(page);
    const t2 = Date.now();
    await sleep(SILENT_WAIT_MS); // another 23 s
    const elapsed2 = Date.now() - t2;
    logInfo('TIMER', `40 s window elapsed: ${elapsed2} ms`);

    const text40s = await collectPageText(page);
    const delta40s = text40s.slice(snapshot1.length).toLowerCase();
    logInfo('TRIGGER-40S', `New text: "${delta40s.slice(0, 200)}"`);

    const trigger40Matched = /no problem|don.t feel like|another time|continue later|feel like chatting|take your time/i.test(delta40s);
    if (!trigger40Matched) {
      logFailure('silent-trigger-40s', ["no problem", "don't feel like chatting", "another time"], delta40s);
      await page.screenshot({ path: join(SCREENSHOTS_DIR, 'fail-silent-40s.png'), fullPage: true });
      logInfo('FAIL', '40 s silent trigger — expected soft-exit phrase not found');
    } else {
      logInfo('PASS', '40 s silent trigger matched');
    }
    expect(trigger40Matched, `[silent-trigger-40s] Expected a soft-exit phrase at ~40 s.\nGot: "${delta40s.slice(0, 200)}"`).toBe(true);

    // ── 60-second trigger ───────────────────────────────────────────────────
    const snapshot2 = await collectPageText(page);
    const t3 = Date.now();
    await sleep(SILENT_WAIT_MS); // another 23 s
    const elapsed3 = Date.now() - t3;
    logInfo('TIMER', `60 s window elapsed: ${elapsed3} ms`);

    const text60s = await collectPageText(page);
    const delta60s = text60s.slice(snapshot2.length).toLowerCase();
    logInfo('TRIGGER-60S', `New text: "${delta60s.slice(0, 200)}"`);

    const trigger60Matched = /\bbye\b|goodbye|chat later|take care|talk later|see you/i.test(delta60s);
    if (!trigger60Matched) {
      logFailure('silent-trigger-60s', ['bye', 'goodbye', 'chat later', 'take care'], delta60s);
      await page.screenshot({ path: join(SCREENSHOTS_DIR, 'fail-silent-60s.png'), fullPage: true });
      logInfo('FAIL', '60 s silent trigger — expected farewell phrase not found');
    } else {
      logInfo('PASS', '60 s silent trigger matched');
    }
    expect(trigger60Matched, `[silent-trigger-60s] Expected a farewell phrase at ~60 s.\nGot: "${delta60s.slice(0, 200)}"`).toBe(true);

    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'pass-silent-triggers.png'), fullPage: true });
    logInfo('PASS', 'All three silent-trigger checks passed');
  });

  test('no duplicate silent-trigger messages in a 70-second silence window', async ({ page }) => {
    test.setTimeout(300000);

    await setupAndWaitForGreeting(page);
    await sendMessage(page, 'Hi there, just browsing for now');
    await waitForBotResponse(page);

    logInfo('INFO', 'Waiting 70 s for all triggers to fire then checking for duplicates…');
    await sleep(72000);

    const fullText = await collectPageText(page);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'silent-trigger-duplicate-check.png'), fullPage: true });

    const stillThereCount = (fullText.match(/still there/gi) || []).length;
    const noProblemsCount  = (fullText.match(/no problem/gi)  || []).length;
    const byeCount         = (fullText.match(/\bbye\b/gi)     || []).length;

    logInfo('INFO', `"still there" occurrences: ${stillThereCount}`);
    logInfo('INFO', `"no problem" occurrences:  ${noProblemsCount}`);
    logInfo('INFO', `"bye" occurrences:         ${byeCount}`);

    expect(stillThereCount, '"still there" trigger should appear at most once').toBeLessThanOrEqual(1);
    expect(noProblemsCount,  '"no problem" trigger should appear at most once').toBeLessThanOrEqual(1);
    expect(byeCount,         '"bye" trigger should appear at most once').toBeLessThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 05 — HUMAN HANDOFF TESTS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('05 - Human Handoff Tests', () => {
  const HANDOFF_RESPONSE_PHRASES = [
    'connect', 'transfer', 'agent', 'human', 'operator', 'connecting',
    'queue', 'ticket', 'busy', 'call you back', 'representative', 'support team',
    'specialist', 'live agent',
  ];

  test('handoff trigger: "Connect me to a human agent"', async ({ page }) => {
    await setupAndWaitForGreeting(page);
    await sendMessage(page, 'Connect me to a human agent');
    await waitForBotResponse(page, 20000);
    await assertResponse(page, 'handoff-connect-human-agent', HANDOFF_RESPONSE_PHRASES);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'handoff-connect-human.png'), fullPage: true });
  });

  test('handoff trigger: "I want to talk to a human"', async ({ page }) => {
    await setupAndWaitForGreeting(page);
    await sendMessage(page, 'I want to talk to a human');
    await waitForBotResponse(page, 20000);
    await assertResponse(page, 'handoff-talk-human', HANDOFF_RESPONSE_PHRASES);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'handoff-talk-human.png'), fullPage: true });
  });

  test('handoff trigger: "Transfer me to an operator"', async ({ page }) => {
    await setupAndWaitForGreeting(page);
    await sendMessage(page, 'Transfer me to an operator');
    await waitForBotResponse(page, 20000);
    await assertResponse(page, 'handoff-transfer-operator', HANDOFF_RESPONSE_PHRASES);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'handoff-transfer-operator.png'), fullPage: true });
  });

  test('handoff trigger: "Can I speak with support?"', async ({ page }) => {
    await setupAndWaitForGreeting(page);
    await sendMessage(page, 'Can I speak with support?');
    await waitForBotResponse(page, 20000);
    await assertResponse(page, 'handoff-speak-support', HANDOFF_RESPONSE_PHRASES);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'handoff-speak-support.png'), fullPage: true });
  });

  test('fallback message appears when no agent is available', async ({ page }) => {
    await setupAndWaitForGreeting(page);
    await sendMessage(page, 'I need to speak with a human agent right now, it is urgent');
    await waitForBotResponse(page, 20000);

    // Primary: handoff starts
    await assertResponse(page, 'handoff-urgent-start', HANDOFF_RESPONSE_PHRASES);

    // Secondary: if no agent available, a proper fallback must be shown
    const pageText = await collectPageText(page);
    const hasFallback = /busy|unavailable|ticket|call you back|callback|raise a ticket|help you with|assist/i.test(pageText);

    logInfo('INFO', `Fallback phrase present: ${hasFallback}`);
    // Log but do not hard-fail — agent availability depends on live staffing
    if (!hasFallback) {
      logFailure('handoff-fallback', ['busy', 'ticket', 'call you back', 'callback'], pageText);
      await page.screenshot({ path: join(SCREENSHOTS_DIR, 'warn-handoff-no-fallback.png'), fullPage: true });
      logInfo('WARN', 'Handoff fallback phrase not found — agent may actually be connected');
    }

    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'handoff-fallback.png'), fullPage: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 06 — HARD ESCALATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('06 - Hard Escalation Tests', () => {
  const ESCALATION_PHRASES = [
    'escalate', 'senior', 'supervisor', 'manager', 'agent', 'transfer',
    'sorry', 'apologize', 'priority', 'understand', 'concern', 'team', 'connect',
  ];

  test('user mentions BTRC — immediate escalation expected', async ({ page }) => {
    await setupAndWaitForGreeting(page);
    await sendMessage(page, "This is unacceptable. I am going to report this to BTRC if you don't fix it now.");
    await waitForBotResponse(page, 20000);
    await assertResponse(page, 'escalation-BTRC', ESCALATION_PHRASES);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'escalation-btrc.png'), fullPage: true });
  });

  test('user requests compensation / refund outside policy', async ({ page }) => {
    await setupAndWaitForGreeting(page);
    await sendMessage(page, 'I want compensation for the poor service. You should give me a full refund for last month.');
    await waitForBotResponse(page, 20000);
    await assertResponse(page, 'escalation-compensation', ESCALATION_PHRASES);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'escalation-compensation.png'), fullPage: true });
  });

  test('user says this is their third repeated complaint', async ({ page }) => {
    await setupAndWaitForGreeting(page);
    await sendMessage(page, 'This is the third time I am complaining about the same issue and nothing has been done.');
    await waitForBotResponse(page, 20000);
    await assertResponse(page, 'escalation-repeat-complaint', ESCALATION_PHRASES);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'escalation-repeat.png'), fullPage: true });
  });

  test('user missed important business call due to network failure', async ({ page }) => {
    await setupAndWaitForGreeting(page);
    await sendMessage(page, 'I missed an important business call because of your network failure. This cost me a major deal. I need to speak to a manager.');
    await waitForBotResponse(page, 20000);
    await assertResponse(page, 'escalation-business-loss', ESCALATION_PHRASES);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'escalation-business-call.png'), fullPage: true });
  });

  test('highly frustrated user demanding supervisor — bot must not continue generic troubleshooting', async ({ page }) => {
    await setupAndWaitForGreeting(page);

    // Build context: network complaint first
    await sendMessage(page, 'My network has been down for two days and none of your fixes have worked.');
    await waitForBotResponse(page);

    // Hard escalation trigger
    await sendMessage(page, 'This is absolutely ridiculous! I demand to speak to a supervisor IMMEDIATELY. No more troubleshooting steps!');
    await waitForBotResponse(page, 20000);

    const pageText = await collectPageText(page);

    // Verify bot stopped offering generic troubleshooting tips
    const continuesGeneric = /restart.*phone|turn.*off.*on|reset.*APN|check.*setting|try.*airplane/i.test(
      pageText.split('\n').slice(-10).join(' ')
    );
    if (continuesGeneric) {
      logFailure('escalation-no-generic', ['should escalate, not troubleshoot'], pageText);
      await page.screenshot({ path: join(SCREENSHOTS_DIR, 'fail-escalation-generic.png'), fullPage: true });
      logInfo('FAIL', 'Bot continued generic troubleshooting after escalation trigger');
    }
    expect(continuesGeneric, 'Bot must NOT continue generic troubleshooting after an explicit escalation demand').toBe(false);

    // Verify escalation response is present
    await assertResponse(page, 'escalation-frustrated', ESCALATION_PHRASES);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'escalation-frustrated.png'), fullPage: true });
  });

  test('multi-turn escalation: bot stops generic steps after explicit supervisor request', async ({ page }) => {
    await setupAndWaitForGreeting(page);

    await sendMessage(page, 'I have no network signal for the past 3 hours in Dhaka.');
    await waitForBotResponse(page);

    await sendMessage(page, 'I have already tried restarting. Nothing works.');
    await waitForBotResponse(page);

    await sendMessage(page, "I've tried everything you suggested. I want a supervisor now — stop the scripted responses.");
    await waitForBotResponse(page, 20000);

    // Last N lines should NOT contain further generic steps
    const pageText = await collectPageText(page);
    const lastLines = pageText.split('\n').slice(-8).join(' ');
    const stillGeneric = /try.*restart|disable.*enable|reset.*network|airplane mode/i.test(lastLines);

    expect(stillGeneric, 'After "I want a supervisor now", bot should not keep offering troubleshooting steps').toBe(false);

    await assertResponse(page, 'escalation-multi-turn', ESCALATION_PHRASES);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'escalation-multi-turn.png'), fullPage: true });
  });
});
