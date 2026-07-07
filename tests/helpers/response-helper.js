/**
 * "Send a message, then wait for the bot's reply" pair. Co-located because
 * every call site uses them together — capture a baseline, send, then wait
 * for new content beyond that baseline.
 *
 * `waitForBotResponse` is the mechanical PASS gate ("did the bot respond at
 * all"); specs that also need to validate specific business wording should
 * layer a `checkPhraseGroups` call (logging-helper.js) on top of the text
 * this returns.
 */
import { join } from 'path';
import { sleep, getAllFramesText, settleText } from './browser-utils.js';
import { TIMEOUTS } from './timeouts.js';

/**
 * Types text into the chat textbox, presses Enter, and falls back to clicking
 * the Send button if the input value wasn't cleared by Enter.
 */
export async function sendMessage(page, text, opts = {}) {
  const inputWaitMs = opts.inputWaitMs ?? TIMEOUTS.CHAT_OPEN;
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
  await sleep(TIMEOUTS.POST_SEND_SETTLE);
}

/**
 * Polls the combined text of all frames until it grows beyond a baseline by
 * more than minExtraChars — signaling new (bot) content arrived. Ignores the
 * widget's echo of the user's own message by adding sentText's length to the
 * threshold. Language/wording agnostic — no phrase list required. Throws on
 * timeout (after screenshotting).
 *
 * @param {object} opts.baselineText   text captured via getAllFramesText() right before sendMessage (required)
 * @param {string} opts.sentText       the message that was just sent, so its echo isn't mistaken for a reply
 * @param {number} opts.timeoutMs      total budget (default: TIMEOUTS.BOT_RESPONSE)
 * @param {number} opts.minExtraChars  minimum new chars to count as a reply (default: 5)
 * @returns {string} the full page/frame text at the moment the reply was detected
 */
export async function waitForBotResponse(page, opts = {}) {
  const prefix = opts.prefix ?? '[RESPONSE]';
  const reportDir = opts.reportDir ?? null;
  const baselineText = opts.baselineText ?? '';
  const sentText = opts.sentText ?? '';
  const timeoutMs = opts.timeoutMs ?? TIMEOUTS.BOT_RESPONSE;
  const minExtraChars = opts.minExtraChars ?? 5;
  const pollMs = opts.pollMs ?? TIMEOUTS.POLL_INTERVAL_FAST;

  const threshold = baselineText.length + sentText.length + minExtraChars;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await getAllFramesText(page);
    if (current.length >= threshold && current !== baselineText) {
      const settled = await settleText(page, current, { pollMs });
      console.log(`${prefix} Bot response received (${settled.length} chars)`);
      return settled;
    }
    await sleep(pollMs);
  }

  if (reportDir) {
    const path = join(reportDir, `${prefix.replace(/\W/g, '')}-response-fail-${Date.now()}.png`);
    await page.screenshot({ path }).catch(() => {});
    console.log(`${prefix} Screenshot saved: ${path}`);
  }
  throw new Error(`${prefix} No bot response detected within ${timeoutMs}ms`);
}
