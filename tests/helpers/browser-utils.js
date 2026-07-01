/**
 * Global CI browser stabilization helpers.
 *
 * All test suites import from here to avoid duplicating these patterns:
 *  - navigateTo()           – page.goto() + stealth init scripts (navigator.webdriver patch)
 *  - waitForPageReady()     – wait for document.readyState === 'complete' + network idle
 *  - checkAndHandleCloudflare() – detect CF challenge, wait up to 90s, fail clearly
 *  - openChatWidget()       – robust chat-launch helper (DOM + shadow DOM + iframes + role locators)
 *  - dumpChatDebugInfo()    – log URL/title/body/buttons/iframes/widget-script before failing
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
 * Checks whether a Cloudflare challenge page is showing and waits up to
 * timeoutMs (default 90 s) for it to clear. Throws a descriptive error if it
 * never clears.
 */
export async function checkAndHandleCloudflare(page, prefix = '[CF]', reportDir = null, timeoutMs = 90000) {
  const html = await page.content().catch(() => '');
  const title = await page.title().catch(() => '');
  const combined = html + ' ' + title;

  if (!CF_SIGNATURES.some(sig => combined.includes(sig))) return;

  console.log(`${prefix} [CLOUDFLARE] Challenge detected`);
  console.log(`${prefix} [CLOUDFLARE] Waiting up to ${timeoutMs}ms for clearance`);
  if (reportDir) {
    const path = join(reportDir, `cf-challenge-${Date.now()}.png`);
    await page.screenshot({ path }).catch(() => {});
    console.log(`${prefix} [CLOUDFLARE] Screenshot saved: ${path}`);
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(3000);
    const current = await page.content().catch(() => '');
    if (!CF_SIGNATURES.some(sig => current.includes(sig))) {
      console.log(`${prefix} [CLOUDFLARE] Challenge cleared — continuing`);
      return;
    }
  }

  if (reportDir) {
    const path = join(reportDir, `cf-failed-${Date.now()}.png`);
    await page.screenshot({ path }).catch(() => {});
    console.log(`${prefix} [CLOUDFLARE] Screenshot saved: ${path}`);
  }
  throw new Error(
    `${prefix} [CLOUDFLARE] Challenge page did not clear after ${timeoutMs}ms — page title: "${title}"`
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

/**
 * Waits until the document is fully loaded before we start probing for the
 * chat widget: document.readyState === 'complete', then (best-effort)
 * network idle. Never throws — a slow/streaming page shouldn't fail the test
 * just because network activity never fully quiesces.
 */
export async function waitForPageReady(page, opts = {}) {
  const { timeoutMs = 90000, prefix = '[READY]' } = opts;
  const deadline = Date.now() + timeoutMs;

  try {
    await page.waitForFunction(() => document.readyState === 'complete', null, {
      timeout: timeoutMs,
    });
    console.log(`${prefix} document.readyState === "complete"`);
  } catch {
    console.log(`${prefix} document.readyState did not reach "complete" within ${timeoutMs}ms — continuing`);
  }

  const remaining = Math.max(1000, deadline - Date.now());
  try {
    await page.waitForLoadState('networkidle', { timeout: Math.min(remaining, timeoutMs) });
    console.log(`${prefix} network idle`);
  } catch {
    console.log(`${prefix} network did not idle within timeout — continuing anyway`);
  }
}

// ── Chat widget opener ─────────────────────────────────────────────────────────

const DEFAULT_CHAT_LABELS = [
  'Text Chat', 'Chat', 'Start Chat',
  "Let's Chat", "Let’s Chat", "’s Chat",
  "Let's Talk", 'Lets Talk', 'Talk',
  'Start New Session', 'Start', 'Open Chat',
];

/**
 * Robust chat widget launcher. Tries DOM scan (including shadow DOM),
 * same-origin iframes, and Playwright role/text locators every 2 s until
 * timeoutMs is exhausted.
 *
 * @param {object} opts.prefix         – log prefix, e.g. '[MERKEL]'
 * @param {string} opts.failScreenshotPath – screenshot path on failure
 * @param {string[]} opts.labels       – button text labels to search for
 * @param {number} opts.timeoutMs      – how long to keep trying (default 90 s)
 * @returns {boolean} true if widget was opened, false otherwise
 */
export async function openChatWidget(page, opts = {}) {
  const {
    prefix = '[CHAT]',
    failScreenshotPath = null,
    labels = DEFAULT_CHAT_LABELS,
    timeoutMs = 90000,
  } = opts;

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
  if (failScreenshotPath) await page.screenshot({ path: failScreenshotPath }).catch(() => {});
  return false;
}

/**
 * Logs diagnostic context before failing a "chat button not found" test:
 * current URL, page title, first 1000 chars of body text, all visible
 * buttons, all iframes, and whether a NextLevel widget script tag exists.
 */
export async function dumpChatDebugInfo(page, prefix = '[CHAT]') {
  const url = page.url();
  const title = await page.title().catch(() => '');
  const bodyText = await page.evaluate(() =>
    document.documentElement ? document.documentElement.innerText : ''
  ).catch(() => '');
  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button,[role="button"]'))
      .filter(b => b.offsetParent !== null || b.getClientRects().length > 0)
      .map(b => (b.innerText || b.textContent || b.getAttribute('aria-label') || '').trim())
      .filter(Boolean)
  ).catch(() => []);
  const iframes = page.frames().filter(f => f !== page.mainFrame()).map(f => f.url());
  const widgetScriptExists = await page.evaluate(() =>
    Array.from(document.querySelectorAll('script[src]'))
      .some(s => /nextlevel/i.test(s.src))
  ).catch(() => false);

  console.log(`${prefix} [DEBUG] URL: ${url}`);
  console.log(`${prefix} [DEBUG] Title: ${title}`);
  console.log(`${prefix} [DEBUG] Body (first 1000 chars): ${bodyText.slice(0, 1000)}`);
  console.log(`${prefix} [DEBUG] Visible buttons: ${buttons.length ? buttons.join(', ') : '(none)'}`);
  console.log(`${prefix} [DEBUG] Iframes (${iframes.length}): ${iframes.length ? iframes.join(', ') : '(none)'}`);
  console.log(`${prefix} [DEBUG] NextLevel widget script present: ${widgetScriptExists}`);

  return { url, title, bodyText, buttons, iframes, widgetScriptExists };
}

// ── Generic bot-reply detector (language/wording agnostic) ────────────────────

/**
 * Polls the combined text of all frames until it grows beyond a baseline by
 * more than `minExtraChars`, which signals that new (bot) content was added.
 *
 * Unlike phrase-list matching, this doesn't require exact wording and works
 * for any language/script — it just needs *some* new non-empty content to
 * show up after the baseline was captured. When `sentText` is supplied, its
 * length is added to the threshold so the widget's own echo of the user's
 * message isn't mistaken for a bot reply.
 *
 * @returns {string|null} the new full chat text, or null on timeout
 */
export async function waitForBotReply(page, opts = {}) {
  const {
    baselineText = '',
    sentText = '',
    timeoutMs = 90000,
    minExtraChars = 5,
    pollMs = 1500,
  } = opts;
  const threshold = baselineText.length + sentText.length + minExtraChars;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await getAllFramesText(page);
    if (current.length >= threshold && current !== baselineText) return current;
    await sleep(pollMs);
  }
  return null;
}

// ── Phrase polling helpers ─────────────────────────────────────────────────────

/**
 * Waits for the textbox to appear then polls every 2 s until any phrase count
 * rises above its baseline. Returns the matched phrase, or
 * 'greeting received' if the input is visible but no specific phrase matched.
 */
export async function waitForBotGreeting(page, phrases, baselines, timeoutMs = 90000) {
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
export async function waitForAnyNewOccurrence(page, phrases, baselines, timeoutMs = 90000) {
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
export async function sendMessage(page, text, { inputWaitMs = 90000 } = {}) {
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
    const t = await frame.evaluate(() => {
      function harvest(root) {
        let text = '';
        // Widget panels are sometimes appended as a sibling of <body> (a
        // direct child of <html>), so document.body.innerText alone misses
        // them — walk from documentElement to capture everything rendered.
        const scope = root.documentElement || root.body || root;
        try {
          if (scope && typeof scope.innerText === 'string') text += scope.innerText + '\n';
        } catch (_) {}
        const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
        for (const el of all) {
          if (el.shadowRoot) text += harvest(el.shadowRoot) + '\n';
        }
        return text;
      }
      return harvest(document);
    }).catch(() => '');
    if (t.trim()) parts.push(t.trim());
  }
  return parts.join('\n');
}
