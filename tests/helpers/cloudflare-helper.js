/**
 * Cloudflare / anti-bot challenge detection and clearance.
 *
 * `waitUntilCloudflareClears` is a rename of the original
 * `checkAndHandleCloudflare` (browser-utils.js) — body is unchanged, this is
 * a relocation, not a rewrite, since the detection/polling logic is already
 * proven across several prior stabilization passes.
 */
import { join } from 'path';
import { sleep } from './browser-utils.js';
import { TIMEOUTS } from './timeouts.js';

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
export async function waitUntilCloudflareClears(page, opts = {}) {
  const prefix = opts.prefix ?? '[CF]';
  const reportDir = opts.reportDir ?? null;
  const timeoutMs = opts.timeoutMs ?? TIMEOUTS.CLOUDFLARE;

  const html = await page.content().catch(() => '');
  const title = await page.title().catch(() => '');
  const combined = html + ' ' + title;

  if (!CF_SIGNATURES.some(sig => combined.includes(sig))) return;

  const startedAt = Date.now();
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
      console.log(`${prefix} [CLOUDFLARE] Challenge cleared after ${Date.now() - startedAt}ms — continuing`);
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
