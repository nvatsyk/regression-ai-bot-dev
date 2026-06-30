/**
 * Global CI browser stabilization helpers.
 *
 * All test suites import from here to avoid duplicating these patterns:
 *  - navigateTo()           – page.goto() + stealth init scripts (navigator.webdriver patch)
 *  - checkAndHandleCloudflare() – detect CF challenge, wait up to 30s, fail clearly
 *  - openChatWidget()       – robust chat-launch helper (DOM + shadow DOM + role locators)
 *  - waitForBotGreeting()   – poll until any greeting phrase appears
 *  - waitForAnyNewOccurrence() – poll until any phrase count increases
 *  - captureBaselines()     – snapshot current phrase counts before an action
 *  - sendMessage()          – fill textbox, press Enter, fallback to Send button
 *  - sleep()                – simple delay
 */

import { join } from 'path';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Cloudflare detection ───────────────────────────────────────────────────────

const CF_SIGNATURES = [
  'Please wait while your request is being verified',
  'Checking your browser',
  'cf-browser-verification',
  '__cf_bm',
  'challenge-form',
  'cf-spinner',
  'Cloudflare Ray ID',
  'DDoS protection by Cloudflare',
  'Just a moment',
  'Enable JavaScript and cookies to continue',
];

/**
 * Checks whether a Cloudflare challenge page is showing and waits up to 30 s
 * for it to clear. Throws a descriptive error if it never clears.
 */
export async function checkAndHandleCloudflare(page, prefix = '[CF]', reportDir = null) {
  const html = await page.content().catch(() => '');
  const title = await page.title().catch(() => '');
  const combined = html + ' ' + title;

  if (!CF_SIGNATURES.some(sig => combined.includes(sig))) return;

  console.log(`${prefix} [CLOUDFLARE] Challenge detected — waiting up to 30s for clearance`);
  if (reportDir) {
    const path = join(reportDir, `cf-challenge-${Date.now()}.png`);
    await page.screenshot({ path }).catch(() => {});
    console.log(`${prefix} [CLOUDFLARE] Screenshot saved: ${path}`);
  }

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const current = await page.content().catch(() => '');
    if (!CF_SIGNATURES.some(sig => current.includes(sig))) {
      console.log(`${prefix} [CLOUDFLARE] Challenge cleared — continuing`);
      return;
    }
  }

  if (reportDir) {
    await page.screenshot({ path: join(reportDir, `cf-failed-${Date.now()}.png`) }).catch(() => {});
  }
  throw new Error(
    `${prefix} [CLOUDFLARE] Challenge page did not clear after 30s — page title: "${title}"`
  );
}

// ── Stealth navigation ─────────────────────────────────────────────────────────

/**
 * Navigate to a URL and inject stealth patches (removes navigator.webdriver,
 * adds window.chrome shim, fixes navigator.languages/vendor).
 * The init script is queued before the first load and re-runs on every navigation.
 */
export async function navigateTo(page, url, opts = {}) {
  await page.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    } catch (_) {}
    try {
      if (!window.chrome) window.chrome = {};
      if (!window.chrome.runtime) window.chrome.runtime = {};
    } catch (_) {}
    try {
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    } catch (_) {}
    try {
      Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' });
    } catch (_) {}
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000, ...opts });
}

// ── Chat widget opener ─────────────────────────────────────────────────────────

const DEFAULT_CHAT_LABELS = [
  'Text Chat', 'Chat', 'Start Chat',
  "Let's Chat", "’s Chat", "Let’s Chat",
  "Let's Talk", 'Lets Talk', 'Talk',
  'Start New Session', 'Start', 'Open Chat',
];

/**
 * Robust chat widget launcher. Tries DOM scan (including shadow DOM) and
 * Playwright role/text locators every 2 s until timeoutMs is exhausted.
 *
 * @param {object} opts.prefix         – log prefix, e.g. '[MERKEL]'
 * @param {string} opts.failScreenshotPath – screenshot path on failure
 * @param {string[]} opts.labels       – button text labels to search for
 * @param {number} opts.timeoutMs      – how long to keep trying (default 70 s)
 * @returns {boolean} true if widget was opened, false otherwise
 */
export async function openChatWidget(page, opts = {}) {
  const {
    prefix = '[CHAT]',
    failScreenshotPath = null,
    labels = DEFAULT_CHAT_LABELS,
    timeoutMs = 70000,
  } = opts;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // DOM + shadow DOM scan
    const clicked = await page.evaluate((lbls) => {
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
    }, labels).catch(() => null);

    if (clicked) {
      console.log(`${prefix} Opened chat via DOM click: "${clicked}"`);
      return true;
    }

    // Playwright role + text locators
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
    }

    await sleep(2000);
  }

  const vis = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button,[role="button"]'))
      .map(b => (b.innerText || b.textContent || b.getAttribute('aria-label') || '').trim())
      .filter(Boolean)
  ).catch(() => []);
  console.log(`${prefix} Chat widget NOT found after ${timeoutMs}ms. Visible buttons: ${vis.join(', ')}`);
  if (failScreenshotPath) await page.screenshot({ path: failScreenshotPath }).catch(() => {});
  return false;
}

// ── Phrase polling helpers ─────────────────────────────────────────────────────

/**
 * Waits for the textbox to appear then polls every 2 s until any phrase count
 * rises above its baseline. Returns the matched phrase, or
 * 'greeting received' if the input is visible but no specific phrase matched.
 */
export async function waitForBotGreeting(page, phrases, baselines, timeoutMs = 70000) {
  const start = Date.now();
  await page.getByRole('textbox').waitFor({ timeout: Math.min(60000, timeoutMs) }).catch(() => {});
  await sleep(5000);
  const deadline = start + timeoutMs;
  while (Date.now() < deadline) {
    for (const phrase of phrases) {
      const count = await page.getByText(phrase, { exact: false }).count().catch(() => 0);
      if (count > (baselines[phrase] ?? 0)) return phrase;
    }
    await sleep(2000);
  }
  const inputVisible = await page.getByRole('textbox').isVisible().catch(() => false);
  return inputVisible ? 'greeting received' : null;
}

/**
 * Polls every 2 s until any phrase count rises above its baseline.
 * Returns the matched phrase or null on timeout.
 */
export async function waitForAnyNewOccurrence(page, phrases, baselines, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const phrase of phrases) {
      const count = await page.getByText(phrase, { exact: false }).count().catch(() => 0);
      if (count > (baselines[phrase] ?? 0)) return phrase;
    }
    await sleep(2000);
  }
  return null;
}

/**
 * Snapshots the current occurrence count of each phrase.
 * Call before an action whose effect you want to detect.
 */
export async function captureBaselines(page, phrases) {
  const baselines = {};
  for (const p of phrases) {
    baselines[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
  }
  return baselines;
}

// ── Message sender ─────────────────────────────────────────────────────────────

/**
 * Types text into the chat textbox, presses Enter, and falls back to clicking
 * the Send button if the input value wasn't cleared by Enter.
 */
export async function sendMessage(page, text, { inputWaitMs = 60000 } = {}) {
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
  await sleep(8000);
}

// ── Multi-frame text dump ──────────────────────────────────────────────────────

/** Collects innerText from all frames (main page + iframes). */
export async function getAllFramesText(page) {
  const parts = [];
  for (const frame of page.frames()) {
    const t = await frame.evaluate(() =>
      document.body ? document.body.innerText : ''
    ).catch(() => '');
    if (t.trim()) parts.push(t.trim());
  }
  return parts.join('\n');
}
