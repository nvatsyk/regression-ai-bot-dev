/**
 * Generic (language/wording-agnostic) greeting detector. This is the
 * mechanical PASS gate every spec should use for "did a greeting appear" —
 * specs that also need to validate specific business wording should layer a
 * `checkPhraseGroups` call (logging-helper.js) on top of the text this
 * returns, rather than relying on phrase-matching as the gate itself.
 */
import { join } from 'path';
import { sleep, getAllFramesText, settleText } from './browser-utils.js';
import { TIMEOUTS } from './timeouts.js';

/**
 * Waits for the chat textbox to appear, then polls the combined text of all
 * frames until it grows beyond the baseline (captured on entry, or passed in
 * via opts.baselineText if the caller captured it earlier) — signaling that
 * the bot's first message rendered. Throws on timeout.
 *
 * @param {object} opts.prefix          log prefix, e.g. '[ETIHAD]'
 * @param {string} opts.reportDir       directory for failure screenshots
 * @param {string} opts.baselineText    text captured before chat opened (optional; captured here if omitted)
 * @param {number} opts.timeoutMs       total budget (default: TIMEOUTS.GREETING)
 * @param {number} opts.minExtraChars   minimum new chars to count as a greeting (default: 5)
 * @returns {string} the full page/frame text at the moment the greeting was detected
 */
export async function waitForGreeting(page, opts = {}) {
  const prefix = opts.prefix ?? '[GREETING]';
  const reportDir = opts.reportDir ?? null;
  const timeoutMs = opts.timeoutMs ?? TIMEOUTS.GREETING;
  const minExtraChars = opts.minExtraChars ?? 5;
  const pollMs = opts.pollMs ?? TIMEOUTS.POLL_INTERVAL_FAST;

  const baseline = opts.baselineText ?? await getAllFramesText(page);

  await page.getByRole('textbox').waitFor({ timeout: Math.min(60000, timeoutMs) }).catch(() => {});

  const threshold = baseline.length + minExtraChars;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await getAllFramesText(page);
    if (current.length >= threshold && current !== baseline) {
      const settled = await settleText(page, current, { pollMs });
      console.log(`${prefix} Greeting received (${settled.length} chars)`);
      return settled;
    }
    await sleep(pollMs);
  }

  if (reportDir) {
    const path = join(reportDir, `${prefix.replace(/\W/g, '')}-greeting-fail-${Date.now()}.png`);
    await page.screenshot({ path }).catch(() => {});
    console.log(`${prefix} Screenshot saved: ${path}`);
  }
  throw new Error(`${prefix} No greeting detected within ${timeoutMs}ms`);
}
