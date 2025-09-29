import { test, expect } from '@playwright/test';

test('debug jwplayer availability', async ({ page }) => {
  // Listen to console messages
  const consoleMessages: string[] = [];
  page.on('console', msg => consoleMessages.push(msg.text()));

  // Listen to failed requests
  const failedRequests: string[] = [];
  page.on('requestfailed', request => {
    failedRequests.push(`${request.method()} ${request.url()} - ${request.failure()?.errorText}`);
  });

  // Listen to response status
  page.on('response', response => {
    if (response.status() >= 400) {
      console.log(`Failed response: ${response.status()} ${response.url()}`);
    }
  });

  await page.goto('/_/test/video_player?fake=1');

  // Wait a bit for everything to load
  await page.waitForTimeout(5000);

  // Check what's available on window
  const debugInfo = await page.evaluate(() => {
    return {
      jwplayerExists: typeof (window as any).jwplayer,
      jwplayerType: typeof (window as any).jwplayer,
      jwplayerFunction: typeof (window as any).jwplayer === 'function',
      playerInstance: (window as any).jwplayer ? (window as any).jwplayer('gumroad-player') : null,
      hasGetState: (window as any).jwplayer && (window as any).jwplayer('gumroad-player') ?
        typeof ((window as any).jwplayer('gumroad-player')).getState === 'function' : false
    };
  });

  console.log('Debug info:', debugInfo);
  console.log('Console messages:', consoleMessages);
  console.log('Failed requests:', failedRequests);
});

test('video recovers after HLS expiry during long pause', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__EXPIRE_HLS__ = false; });

  // no network interception needed with Fake JW; expiry is simulated via window flag

  await page.goto('/_/test/video_player?fake=1');

  await expect.poll(async () => {
    return page.evaluate(() => {
      const p = (window as any).jwplayer && (window as any).jwplayer('gumroad-player');
      return p && typeof p.getState === 'function';
    });
  }, { timeout: 10000 }).toBe(true);

  await page.evaluate(async () => {
    const p = (window as any).jwplayer && (window as any).jwplayer('gumroad-player');
    if (p) { try { await p.play(true); } catch(e) {} }
  });

  const initialPos = await page.evaluate(() => {
    const p = (window as any).jwplayer && (window as any).jwplayer('gumroad-player');
    return p ? (p.getPosition && p.getPosition()) || 0 : 0;
  });
  await expect.poll(async () => {
    return page.evaluate((pos0) => {
      const p = (window as any).jwplayer && (window as any).jwplayer('gumroad-player');
      if (!p) return 'no-player';
      const state = p.getState && p.getState();
      const pos   = p.getPosition && p.getPosition();
      if (state === 'playing') return 'playing';
      if (typeof pos === 'number' && pos > (pos0 + 1)) return 'advancing';
      return state || '';
    }, initialPos);
  }, { timeout: 15000 }).toMatch(/^(playing|advancing)$/);

  await page.evaluate(() => {
    const p = (window as any).jwplayer && (window as any).jwplayer('gumroad-player');
    if (p) p.pause(true);
  });

  await page.waitForTimeout(1000);

  // Inject expiry to force an error path (so recoveryAttempts increments)
  await page.evaluate(() => {
    (window as any).__EXPIRE_HLS__ = true;
    const p = (window as any).jwplayer && (window as any).jwplayer('gumroad-player');
    if (p && typeof p.play === 'function') p.play(true);
  });

  // Give the fake a tick to emit the error
  await page.waitForTimeout(150);

  await page.evaluate(() => { (window as any).__EXPIRE_HLS__ = true; });

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    (window as any).__EXPIRE_HLS__ = false;
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  // dump trace/state just before assertion window
  const dbg1 = await page.evaluate(() => ({
    state: (window as any).jwplayer && (window as any).jwplayer('gumroad-player')?.getState?.(),
    attempts: (window as any).__RECOVERY_ATTEMPTS__ || 0,
    pos: (window as any).jwplayer && (window as any).jwplayer('gumroad-player')?.getPosition?.(),
    trace: (window as any).__JW_TRACE__ || []
  }));
  console.log('PRE-ASSERT', dbg1);

  await expect.poll(async () => {
    return page.evaluate(() => {
      const p = (window as any).jwplayer && (window as any).jwplayer('gumroad-player');
      return p ? p.getState && p.getState() : '';
    });
  }, { timeout: 10000 }).toBe('playing');

  const attempts = await page.evaluate(() => (window as any).__RECOVERY_ATTEMPTS__ || 0);
  expect(attempts).toBeGreaterThanOrEqual(1);
  expect(attempts).toBeLessThanOrEqual(3);
  const resumed = await page.evaluate(() => {
    const p = (window as any).jwplayer && (window as any).jwplayer('gumroad-player');
    return p ? (p.getPosition && p.getPosition()) || 0 : 0;
  });
  expect(resumed).toBeGreaterThan(initialPos - 2);

  const trace = await page.evaluate(() => (window as any).__JW_TRACE__ || []);
  console.log('JW_TRACE', trace);
});
