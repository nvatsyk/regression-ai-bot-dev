import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AmBQhSeflnMr2okssO_yM0BaIdHLA_ltRC6wAs7ZcAkq0MKGT2-GHo2UlmZ5rzshsm-BTJXfxo7VmQ5lFSLcsQZshM5Q4bJiOg1BM322ogCNy0Tf-dGS4ZuVWhDviwDrY4S3E8JmAu4ZQQ_aU7A3IEBf_7wZr3_HPJzFE-XDemFkDR2dbciXbkjRKVWyLEj1NpjSWNanV4XnPsgVHVdEK';

const REPORT_DIR = join(process.cwd(), 'reports');

test('bfl-debug: inspect close button area', async ({ page }) => {
  mkdirSync(REPORT_DIR, { recursive: true });

  await page.goto(BOT_URL);
  await page.waitForTimeout(5000);

  // Open chat
  await page.getByText('Text Chat').first().click();
  await page.waitForTimeout(8000);

  // Send a message to make the popup active
  const input = page.getByRole('textbox');
  await input.fill('hello');
  await input.press('Enter');
  await page.waitForTimeout(8000);

  await page.screenshot({ path: join(REPORT_DIR, 'bfl-debug-popup-open.png') });

  // Scan the entire DOM (including shadow roots) for elements near the top-right
  // where the × close button should be
  const elementsNearClose = await page.evaluate(() => {
    const results = [];
    function scan(root, depth) {
      for (const el of root.querySelectorAll('*')) {
        const rect = el.getBoundingClientRect();
        // Capture anything in the top-right quadrant that's small (button-sized)
        if (rect.x > 1100 && rect.y < 300 && rect.width > 0 && rect.width < 100) {
          results.push({
            tag: el.tagName,
            cls: typeof el.className === 'string' ? el.className : (el.getAttribute?.('class') || ''),
            id: el.id || '',
            title: el.title || '',
            ariaLabel: el.getAttribute?.('aria-label') || '',
            x: Math.round(rect.x), y: Math.round(rect.y),
            w: Math.round(rect.width), h: Math.round(rect.height),
            shadow: depth,
          });
        }
        if (el.shadowRoot) scan(el.shadowRoot, depth + 1);
      }
    }
    scan(document.body, 0);
    return results;
  });

  writeFileSync(join(REPORT_DIR, 'bfl-debug-close-elements.json'), JSON.stringify(elementsNearClose, null, 2));

  // Also check what's at exact coordinates near the expected × position
  const pointInfo = await page.evaluate(() => {
    const points = [];
    for (let x = 1215; x <= 1248; x += 3) {
      for (let y = 205; y <= 230; y += 3) {
        const el = document.elementFromPoint(x, y);
        if (el) {
          points.push({ x, y, tag: el.tagName, cls: typeof el.className === 'string' ? el.className : '' });
        }
      }
    }
    return points;
  });
  writeFileSync(join(REPORT_DIR, 'bfl-debug-point-scan.json'), JSON.stringify(pointInfo, null, 2));

  // Check all frames
  const frameUrls = page.frames().map(f => f.url());
  writeFileSync(join(REPORT_DIR, 'bfl-debug-frames-open.txt'), frameUrls.join('\n'));
});
