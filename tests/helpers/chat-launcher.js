/**
 * Universal chat-widget launcher. Every regression spec should call
 * `openChat(page, opts)` instead of implementing its own button-scan/click
 * logic — this is the one place that knows about DOM/shadow-DOM/iframe
 * widgets and the full set of button labels used across bots.
 *
 * Matching is case-insensitive on both the DOM-scan path (explicit
 * `.toLowerCase()`) and the Playwright locator path (`exact: false` locators
 * are case-insensitive/whitespace-normalized by default) — so label variants
 * like "TEXT CHAT" or "Let's chat" (lowercase c) already match the canonical
 * entries below without needing their own list entries.
 */
import { join } from 'path';
import { sleep, waitForPageReady, dumpChatDebugInfo } from './browser-utils.js';
import { waitUntilCloudflareClears } from './cloudflare-helper.js';
import { TIMEOUTS } from './timeouts.js';

export const CHAT_LABELS = [
  'Text Chat', 'Chat', 'Start Chat',
  "Let's Chat", 'Let’s Chat',
  "Let's Talk", 'Lets Talk', 'Talk',
  'Start New Session', 'Start', 'Open Chat',
];

function scanFn(lbls) {
  function scanRoot(root) {
    return Array.from(root.querySelectorAll('button,[role="button"]')).find(el => {
      const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim();
      return lbls.some(l => t.toLowerCase().includes(l.toLowerCase()));
    }) || null;
  }
  let el = scanRoot(document);
  if (!el) {
    for (const host of document.querySelectorAll('*')) {
      if (host.shadowRoot) { el = scanRoot(host.shadowRoot); if (el) break; }
    }
  }
  if (el) { el.click(); return (el.innerText || el.textContent || '').trim(); }
  return null;
}

/**
 * Opens the chat widget: waits for the page to finish loading, clears any
 * Cloudflare challenge, then retries a DOM + shadow-DOM + same-origin-iframe
 * scan and a Playwright role/text locator scan (covers cross-origin iframes)
 * every 2s until timeoutMs is exhausted.
 *
 * Throws a descriptive Error (after logging visible buttons via
 * dumpChatDebugInfo and screenshotting) if the widget is never found —
 * callers no longer need to check a boolean return value.
 *
 * @param {object} opts.prefix          log prefix, e.g. '[MERKEL]'
 * @param {string} opts.reportDir       directory for failure screenshots
 * @param {string[]} opts.labels        button labels to search for (default: CHAT_LABELS)
 * @param {number} opts.timeoutMs       total retry budget (default: TIMEOUTS.CHAT_OPEN)
 * @param {boolean} opts.waitForReady   wait for document/network ready first (default: true)
 * @param {boolean} opts.clearCloudflare clear a CF challenge first if present (default: true)
 * @returns {true} on success
 */
export async function openChat(page, opts = {}) {
  const prefix = opts.prefix ?? '[CHAT]';
  const reportDir = opts.reportDir ?? null;
  const labels = opts.labels ?? CHAT_LABELS;
  const timeoutMs = opts.timeoutMs ?? TIMEOUTS.CHAT_OPEN;
  const waitForReady = opts.waitForReady ?? true;
  const clearCloudflare = opts.clearCloudflare ?? true;

  if (waitForReady) {
    await waitForPageReady(page, { timeoutMs: TIMEOUTS.PAGE_READY, prefix });
  }
  if (clearCloudflare) {
    await waitUntilCloudflareClears(page, { prefix, reportDir, timeoutMs: TIMEOUTS.CLOUDFLARE });
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // DOM + shadow DOM scan on the main frame
    const clicked = await page.evaluate(scanFn, labels).catch(() => null);
    if (clicked) {
      console.log(`${prefix} Opened chat via DOM click: "${clicked}"`);
      return true;
    }

    // Same-origin iframes (the widget is sometimes embedded in one)
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const clickedInFrame = await frame.evaluate(scanFn, labels).catch(() => null);
      if (clickedInFrame) {
        console.log(`${prefix} Opened chat via iframe DOM click: "${clickedInFrame}" (frame: ${frame.url()})`);
        return true;
      }
    }

    // Playwright role + text locators (covers cross-origin iframes too)
    for (const lbl of labels) {
      const byRole = page.getByRole('button', { name: lbl, exact: false }).first();
      if (await byRole.isVisible().catch(() => false)) {
        console.log(`${prefix} Opened chat via role locator: "${lbl}"`);
        await byRole.click();
        return true;
      }
      const byText = page.getByText(lbl, { exact: false }).first();
      if (await byText.isVisible().catch(() => false)) {
        console.log(`${prefix} Opened chat via text locator: "${lbl}"`);
        await byText.click();
        return true;
      }
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        const frameByRole = frame.getByRole('button', { name: lbl, exact: false }).first();
        if (await frameByRole.isVisible().catch(() => false)) {
          console.log(`${prefix} Opened chat via iframe role locator: "${lbl}" (frame: ${frame.url()})`);
          await frameByRole.click();
          return true;
        }
      }
    }

    await sleep(2000);
  }

  console.log(`${prefix} Chat widget NOT found after ${timeoutMs}ms.`);
  await dumpChatDebugInfo(page, prefix);
  if (reportDir) {
    const path = join(reportDir, `${prefix.replace(/\W/g, '')}-chat-open-fail-${Date.now()}.png`);
    await page.screenshot({ path }).catch(() => {});
    console.log(`${prefix} Screenshot saved: ${path}`);
  }
  throw new Error(`${prefix} Chat widget not found after ${timeoutMs}ms (tried labels: ${labels.join(', ')})`);
}
