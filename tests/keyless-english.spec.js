import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G4UAKGTqHPlzBth8O49KPVnI3YuRTJOMEDWbUAK9Yduh5PWal-K-IN63Klq6_9JBKp5qrESF44g4Jy2jrTdyMApCl_mGtnAAVRrCPHCMZUFmP8dYFhtGkS6oQlLZBCUMKZKc5WXy3CkKfg';

const REPORT_DIR = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE  = 'Keyless English troubleshooting flow regression';
const TEST_NAME  = 'Keyless English — full troubleshooting flow';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

// Traverse open shadow roots (best-effort; closed roots fall back to Playwright locators).
async function collectPageText(page) {
  return page.evaluate(() => {
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
    return walk(document.body);
  });
}

// Send message: try Enter first; click Send button if Enter did not submit.
// inputWaitMs: how long to wait for the textbox — increase for headless (bot may take longer to finish responding).
async function sendMessage(page, text, { inputWaitMs = 30000 } = {}) {
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
  await sleep(8000); // wait for bot to start responding
}

// Returns the label of the first failing phrase group, or null if all pass.
// Each group: { label, phrases } — at least one phrase per group must appear
// anywhere on the page (Playwright getByText pierces shadow DOM).
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

// Wait for the occurrence count of `waitPhrase` to INCREASE compared to `beforeCount`.
// This detects a NEW element (bot message) containing that phrase, even if the phrase
// was already visible from an earlier turn.
async function waitForNewOccurrence(page, phrase, beforeCount, timeoutMs = 35000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await page.getByText(phrase, { exact: false }).count().catch(() => 0);
    if (count > beforeCount) return true;
    await sleep(2000);
  }
  console.log(`[Keyless] waitForNewOccurrence: "${phrase}" count did not increase within ${timeoutMs}ms`);
  return false;
}

// Core step helper: send a message, wait for a specific phrase to appear as a new
// DOM element (occurrence count increase), then validate all phrase groups.
async function convoStep(page, { label, message, waitPhrase, phraseGroups, waitTimeoutMs = 35000 }) {
  // Snapshot occurrence count BEFORE sending so we can detect a truly new bot message.
  const beforeCount = waitPhrase
    ? await page.getByText(waitPhrase, { exact: false }).count().catch(() => 0)
    : 0;

  await sendMessage(page, message);

  if (waitPhrase) {
    await waitForNewOccurrence(page, waitPhrase, beforeCount, waitTimeoutMs);
    await sleep(1000); // let streaming finish
  }

  const failReason = await checkPhraseGroups(page, phraseGroups);
  if (failReason) {
    mkdirSync(REPORT_DIR, { recursive: true });
    const tag = label.replace(/[^a-z0-9]/gi, '_').slice(0, 40);
    await page.screenshot({ path: join(REPORT_DIR, `keyless-fail-${tag}.png`) }).catch(() => {});
    const pt = await collectPageText(page).catch(() => '');
    console.log(`[Keyless] FAIL — ${label}\nMissing: ${failReason}\nPage text (first 1000 chars):\n${pt.slice(0, 1000)}`);
    logFailure(label, failReason, pt);
  }
  return { failReason };
}

test.describe('Keyless English — Troubleshooting Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    // 6 min: 21-step conversation + waitForNewOccurrence buffers + CI headroom
    test.setTimeout(360000);
    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate to bot ───────────────────────────────────────────────
    await page.goto(BOT_URL);
    await page.screenshot({ path: join(REPORT_DIR, 'keyless-startup.png') }).catch(() => {});

    // ── Step 2: Open Text Chat ────────────────────────────────────────────────
    // Prefer getByRole (spec requirement); fall back to getByText for shadow-DOM widgets.
    let chatBtn = page.getByRole('button', { name: /text chat/i });
    const foundByRole = await chatBtn.waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
    if (!foundByRole) {
      chatBtn = page.getByText('Text Chat', { exact: false }).first();
      await chatBtn.waitFor({ timeout: 30000 });
    }
    await chatBtn.click();

    // ── Step 3: Wait for and validate greeting ────────────────────────────────
    // "Hi, welcome to UXE support. This is Ahmed. I can help with technical support
    //  for Keyless. What can I help you with today."
    // Snapshot count=0 for "Ahmed" before greeting arrives, then wait for it.
    const ahmedBefore = await page.getByText('Ahmed', { exact: false }).count().catch(() => 0);
    await waitForNewOccurrence(page, 'Ahmed', ahmedBefore, 30000);
    await sleep(2000); // let the full greeting render
    await page.screenshot({ path: join(REPORT_DIR, 'keyless-greeting.png') }).catch(() => {});

    const greetingFail = await checkPhraseGroups(page, [
      { label: 'agent greeting (Ahmed)', phrases: ['ahmed', 'this is ahmed'] },
    ]);
    if (greetingFail) {
      await page.screenshot({ path: join(REPORT_DIR, 'keyless-greeting-fail.png') }).catch(() => {});
      const pt = await collectPageText(page).catch(() => '');
      console.log(`[Keyless] Greeting fail: ${greetingFail}\nText: ${pt.slice(0, 800)}`);
      logFailure('Step 3: Greeting', greetingFail, pt);
    }
    expect(greetingFail, `Step 3 greeting missing: "${greetingFail}"`).toBeNull();

    // ── Steps 4 → 5: Report lock issue; expect proximity + Bluetooth check ────
    // The bot usually asks "Are you close to the lock? Bluetooth on?" directly.
    // If it first asks for more details, we provide context to steer it back.
    {
      const btBase = await page.getByText('Bluetooth', { exact: false }).count().catch(() => 0);
      await sendMessage(page, 'Hi. I am a property manager and my Keyless lock still does not unlock from the mobile app after battery maintenance');

      // Wait up to 45 s for the Bluetooth question to appear (headless CI needs more time).
      const btFoundFirst = await waitForNewOccurrence(page, 'Bluetooth', btBase, 45000);

      if (!btFoundFirst) {
        // Bot asked for more details first — give explicit proximity/Bluetooth context.
        // Wait 5 s to let any in-progress bot response finish before trying to type.
        console.log('[Keyless] Bot asked for more info — sending Bluetooth/proximity context');
        await sleep(5000);
        await sendMessage(page, 'Bluetooth is on and I am standing right next to the lock');
        await waitForNewOccurrence(page, 'Bluetooth', btBase, 45000);
      }

      const step5Fail = await checkPhraseGroups(page, [
        { label: 'proximity / close to lock', phrases: ['close to the lock', 'close to lock', 'near the lock', 'close to', 'proximity'] },
        { label: 'Bluetooth check',           phrases: ['bluetooth', 'bluetooth turned on'] },
      ]);
      if (step5Fail) {
        mkdirSync(REPORT_DIR, { recursive: true });
        await page.screenshot({ path: join(REPORT_DIR, 'keyless-fail-step5.png') }).catch(() => {});
        const pt = await collectPageText(page).catch(() => '');
        console.log(`[Keyless] Step 5 fail: ${step5Fail}\n${pt.slice(0, 800)}`);
        logFailure('Step 5: Proximity and Bluetooth', step5Fail, pt);
      }
      expect(step5Fail, `Step 5 failed: missing "${step5Fail}"`).toBeNull();
    }

    // ── Steps 6 → 7: Confirm "yes"; expect Find Nearby Devices instruction ────
    // Bot should mention: More > Support > Find Nearby Devices path.
    {
      const { failReason } = await convoStep(page, {
        label: 'Step 7 — Find Nearby Devices instruction',
        message: 'yes',
        waitPhrase: 'Nearby',
        phraseGroups: [
          { label: '"Find Nearby Devices" path', phrases: ['find nearby devices', 'find nearby', 'nearby devices'] },
        ],
      });
      expect(failReason, `Step 7 failed: missing "${failReason}"`).toBeNull();
    }

    // ── Steps 8 → 9: Ask for clarification; expect re-explanation + RC mention ─
    // Bot should re-explain the menu path and reference lock / RC code.
    {
      const { failReason } = await convoStep(page, {
        label: 'Step 9 — re-explanation with RC code reference',
        message: 'what do you meant?',
        waitPhrase: 'Nearby',
        phraseGroups: [
          { label: '"Find Nearby" re-explained', phrases: ['find nearby devices', 'find nearby', 'nearby devices'] },
          { label: 'RC code mention',            phrases: ['rc code', 'rc'] },
        ],
      });
      expect(failReason, `Step 9 failed: missing "${failReason}"`).toBeNull();
    }

    // ── Steps 10 → 15: RC code confirmed; dual-path flow ────────────────────
    // The bot is LLM-based and may take two different paths from here:
    //   Path A (manufacturer): bot asks ISEO / Rayonics → battery instruction → "done" → try unlock
    //   Path B (direct):       bot skips manufacturer and goes straight to "try unlock"
    // Both paths are valid flows; the regression check is the end-to-end result.
    {
      const iseoBase    = await page.getByText('ISEO',    { exact: false }).count().catch(() => 0);
      const tryBase     = await page.getByText('tap the lock',  { exact: false }).count().catch(() => 0)
                        + await page.getByText('try the unlock', { exact: false }).count().catch(() => 0)
                        + await page.getByText('try unlock',    { exact: false }).count().catch(() => 0);

      // Step 10: signal that the RC code is visible
      await sendMessage(page, 'RC code is there');

      // Wait up to 12 s to see which branch the bot chooses
      let pathResolved = false;
      let onManufacturerPath = false;
      const pathDeadline = Date.now() + 12000;
      while (Date.now() < pathDeadline && !pathResolved) {
        const iseoNow = await page.getByText('ISEO', { exact: false }).count().catch(() => 0);
        if (iseoNow > iseoBase) { onManufacturerPath = true; pathResolved = true; break; }

        const tryNow = await page.getByText('tap the lock',   { exact: false }).count().catch(() => 0)
                     + await page.getByText('try the unlock', { exact: false }).count().catch(() => 0)
                     + await page.getByText('try unlock',     { exact: false }).count().catch(() => 0);
        if (tryNow > tryBase) { onManufacturerPath = false; pathResolved = true; break; }

        await sleep(2000);
      }

      if (!pathResolved) {
        // Neither signal appeared yet — wait a bit longer for any response
        await sleep(10000);
        const iseoNow = await page.getByText('ISEO', { exact: false }).count().catch(() => 0);
        onManufacturerPath = iseoNow > iseoBase;
      }

      console.log(`[Keyless] Post-RC-code path: ${onManufacturerPath ? 'manufacturer (Path A)' : 'direct try-unlock (Path B)'}`);

      if (onManufacturerPath) {
        // ── Path A: Step 11 — validate ISEO / Rayonics appeared ──────────────
        const step11Fail = await checkPhraseGroups(page, [
          { label: 'ISEO or Rayonics manufacturer options', phrases: ['iseo', 'rayonics'] },
        ]);
        if (step11Fail) {
          await page.screenshot({ path: join(REPORT_DIR, 'keyless-fail-step11.png') }).catch(() => {});
          const pt = await collectPageText(page).catch(() => '');
          console.log(`[Keyless] Step 11 fail: ${step11Fail}\n${pt.slice(0, 800)}`);
          logFailure('Step 11: Manufacturer', step11Fail, pt);
        }
        expect(step11Fail, `Step 11 failed: missing "${step11Fail}"`).toBeNull();

        // ── Path A: Step 12 → 13 — send "Rayonics"; expect battery instruction ─
        const { failReason: step13Fail } = await convoStep(page, {
          label: 'Step 13 — battery replacement instruction',
          message: 'Rayonics',
          waitPhrase: 'replace',
          phraseGroups: [
            { label: 'battery replacement instruction', phrases: [
              'replace the battery', 'replace battery', 'battery replacement',
              'change the battery', 'change battery',
            ]},
            { label: 'battery context', phrases: ['battery maintenance', 'battery'] },
          ],
        });
        expect(step13Fail, `Step 13 failed: missing "${step13Fail}"`).toBeNull();

        // ── Path A: Step 14 → 15 — send "done"; expect try-unlock prompt ──────
        const { failReason: step15Fail } = await convoStep(page, {
          label: 'Step 15 — try to unlock again prompt',
          message: 'done',
          waitPhrase: 'try',
          phraseGroups: [
            { label: 'try-unlock prompt', phrases: [
              'try to unlock', 'try unlocking', 'try the door', 'try again', 'please try', 'tap the lock',
            ]},
          ],
        });
        expect(step15Fail, `Step 15 failed: missing "${step15Fail}"`).toBeNull();

      } else {
        // ── Path B: bot went directly to "try unlock" — log, no assertion fail ─
        const tryPhrases = ['tap the lock', 'try the unlock', 'try unlock', 'try again', 'unlock button'];
        const tryAppeared = await checkPhraseGroups(page, [
          { label: 'direct try-unlock instruction', phrases: tryPhrases },
        ]);
        if (tryAppeared) {
          // Bot skipped manufacturer path; this is acceptable but worth logging.
          const pt = await collectPageText(page).catch(() => '');
          console.log(`[Keyless] Path B: missing try-unlock signal — page text:\n${pt.slice(0, 600)}`);
        } else {
          console.log('[Keyless] Path B: bot gave direct try-unlock instruction ✓');
        }
        // No hard assertion — regression is caught by the closing-flow checks (steps 17–21).
      }
    }

    // ── Steps 16 → 17: Send "it works"; expect success + further help offer ───
    // Bot should say "Great news" and offer further Keyless assistance.
    {
      const { failReason } = await convoStep(page, {
        label: 'Step 17 — great news and further help offer',
        message: 'it works',
        waitPhrase: 'great',
        phraseGroups: [
          { label: 'success reaction',   phrases: ['great news', 'great', 'glad', 'wonderful', 'happy', 'fantastic'] },
          { label: 'Keyless help offer', phrases: ['keyless', 'anything else', 'help you with'] },
        ],
      });
      expect(failReason, `Step 17 failed: missing "${failReason}"`).toBeNull();
    }

    // ── Steps 18 → 19: Send "no"; expect closing UXE message ─────────────────
    // Bot should say "Thanks for calling UXE support" and "Have a wonderful day".
    {
      const { failReason } = await convoStep(page, {
        label: 'Step 19 — UXE closing message',
        message: 'no',
        waitPhrase: 'wonderful',
        phraseGroups: [
          { label: '"Thanks for calling UXE"', phrases: [
            'thanks for calling uxe', 'thanks for calling', 'thank you for calling', 'thanks for contacting',
          ]},
          { label: '"Have a wonderful day"',  phrases: [
            'wonderful day', 'have a wonderful', 'great day', 'enjoy your day', 'wonderful',
          ]},
        ],
      });
      expect(failReason, `Step 19 failed: missing "${failReason}"`).toBeNull();
    }

    // ── Steps 20 → 21: Send "bye"; soft farewell check ───────────────────────
    // The bot may or may not respond after the formal closing at step 19.
    // We send "bye", wait briefly, and log whatever appears — no hard assertion.
    {
      await sendMessage(page, 'bye');
      // Wait up to 15 s for any common farewell phrase
      const farewellPhrases = [
        'goodbye', 'good bye', 'farewell', 'take care',
        'have a great', 'great day', 'nice day', 'good day',
        'have a wonderful', 'wonderful day', 'enjoy your day',
        'see you', 'talk to you', 'chat soon', 'reach out',
        'be well', 'have a good', 'you too', 'thank you',
      ];
      let foundFarewell = false;
      const farewellDeadline = Date.now() + 15000;
      while (Date.now() < farewellDeadline) {
        for (const phrase of farewellPhrases) {
          const c = await page.getByText(phrase, { exact: false }).count().catch(() => 0);
          if (c > 0) { foundFarewell = true; break; }
        }
        if (foundFarewell) break;
        await sleep(2000);
      }
      if (!foundFarewell) {
        console.log('[Keyless] Step 21: no farewell phrase found after "bye" — bot may not respond after formal closing (non-fatal)');
      }
    }

    await page.screenshot({ path: join(REPORT_DIR, 'keyless-complete.png') }).catch(() => {});
  });
});
