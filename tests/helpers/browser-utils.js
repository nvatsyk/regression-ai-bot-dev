/**
 * Low-level browser primitives shared by the higher-level helpers
 * (chat-launcher.js, greeting-helper.js, response-helper.js,
 * cloudflare-helper.js) and, where still useful directly, by specs:
 *  - sleep()                – simple delay
 *  - navigateTo()           – page.goto() + stealth init scripts (navigator.webdriver patch)
 *  - waitForPageReady()     – wait for document.readyState === 'complete' + network idle
 *  - dumpChatDebugInfo()    – log URL/title/body/buttons/iframes/widget-script before failing
 *  - getAllFramesText()     – collect innerText across all frames + shadow DOM
 *  - captureBaselines()     – snapshot current phrase counts before an action
 *  - waitForAnyNewOccurrence() – poll until any phrase count increases (business-assertion layer)
 *
 * Chat launching, greeting/response detection, and Cloudflare handling live
 * in their own dedicated helper modules — see tests/helpers/chat-launcher.js,
 * greeting-helper.js, response-helper.js, cloudflare-helper.js.
 */

export const sleep = ms => new Promise(r => setTimeout(r, ms));

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

// ── Debug dump ──────────────────────────────────────────────────────────────────

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

// ── Multi-frame text dump ──────────────────────────────────────────────────────

/** Collects innerText from all frames (main page + iframes), piercing shadow DOM. */
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

// ── Streaming-response settle helper ───────────────────────────────────────────

/**
 * Once new content has been detected, bots that stream their reply token-by-token
 * can still be mid-render. Poll a few more times and only return once the text
 * stops changing between polls, so callers don't check content against a
 * partially-streamed response.
 */
export async function settleText(page, seenText, { pollMs = 1500, maxExtraPolls = 3 } = {}) {
  let prev = seenText;
  for (let i = 0; i < maxExtraPolls; i++) {
    await sleep(pollMs);
    const current = await getAllFramesText(page);
    if (current === prev) return current;
    prev = current;
  }
  return prev;
}

// ── Phrase polling helpers (business-assertion layer) ──────────────────────────

/**
 * Polls every 2 s until any phrase count rises above its baseline.
 * Returns the matched phrase or null on timeout. Kept for specs that layer
 * business-specific wording checks on top of the generic mechanical gates.
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
