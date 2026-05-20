const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://demo.nextlevel.ai/std/#config=G74AiORyTmV30UmJ5Pg7Qlsg0skB-29FLbACK2sLxAPNbQxBG52bbaH2hIym9j9l_FxcYzRGTYw8oIwcBGUE9EKLgppuWQhRek5NMjjCHn3jT0NrxyidcuUMum8erOAW6PAZgb0GUEH6FK0NSBDl_-9GV7_Dn4sjCLP-vGnmNbDrZjOC6gqqQlRHNohgciZRRJ4jDCNJIqshSoKLFg');
  await page.waitForTimeout(6000);

  const elements = await page.evaluate(() => {
    const sel = 'input, textarea, button, [role="textbox"], [contenteditable]';
    return Array.from(document.querySelectorAll(sel)).map(e => ({
      tag: e.tagName,
      type: e.getAttribute('type'),
      placeholder: e.getAttribute('placeholder'),
      ariaLabel: e.getAttribute('aria-label'),
      className: e.className,
      id: e.id,
      name: e.getAttribute('name'),
      text: e.innerText ? e.innerText.slice(0, 60) : ''
    }));
  });

  console.log('ELEMENTS:', JSON.stringify(elements, null, 2));

  // Also grab a snapshot of message containers
  const msgs = await page.evaluate(() => {
    const allDivs = Array.from(document.querySelectorAll('div, p, span'));
    return allDivs
      .filter(el => el.innerText && el.innerText.length > 20 && el.innerText.length < 300)
      .slice(0, 20)
      .map(el => ({ tag: el.tagName, className: el.className, text: el.innerText.slice(0, 100) }));
  });
  console.log('MESSAGES/CONTENT:', JSON.stringify(msgs, null, 2));

  await browser.close();
})();
