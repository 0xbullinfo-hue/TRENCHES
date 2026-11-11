import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3006';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const VIEWPORTS = [320, 360, 375, 390, 430, 768, 1024, 1280, 1440];

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
    });
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.callbacks.has(data.id)) {
        const { resolve, reject } = this.callbacks.get(data.id);
        this.callbacks.delete(data.id);
        if (data.error) reject(new Error(data.error.message));
        else resolve(data.result);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    return res.result?.value;
  }

  close() {
    this.ws.close();
  }
}

async function runBrowserTests() {
  console.log('[Browser Tests] Starting Chrome in headless mode...');
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1440,900',
  ]);

  let cdp = null;

  try {
    // Wait for Chrome CDP to be available
    let connected = false;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch('http://127.0.0.1:9222/json/new', { method: 'PUT' });
        const target = await res.json();
        cdp = new CDPClient(target.webSocketDebuggerUrl);
        await cdp.ready;
        connected = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    assert.ok(connected, 'Must connect to Chrome via CDP');
    console.log('[Browser Tests] Connected to Chrome DevTools Protocol.');

    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');

    // ------------------------------------------------------------------------
    // TEST 1: Viewports audit (Sticky Header & Responsive Dimensions)
    // ------------------------------------------------------------------------
    console.log('\n--- 1. Testing Sticky Header at Viewport Widths ---');
    for (const w of VIEWPORTS) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: w,
        height: 800,
        deviceScaleFactor: 1,
        mobile: w < 1024,
      });

      await cdp.send('Page.navigate', { url: `${BASE_URL}/` });
      await new Promise((r) => setTimeout(r, 1200));

      const headerInfo = await cdp.eval(`
        (() => {
          const header = document.querySelector('header');
          if (!header) return null;
          const rect = header.getBoundingClientRect();
          const style = window.getComputedStyle(header);
          return {
            exists: true,
            position: style.position,
            top: style.top,
            zIndex: style.zIndex,
            height: rect.height,
            width: rect.width,
            isSticky: style.position === 'sticky' && style.top === '0px'
          };
        })()
      `);

      assert.ok(headerInfo?.exists, `Header must exist at ${w}px`);
      assert.equal(headerInfo.position, 'sticky', `Header position must be sticky at ${w}px`);
      assert.equal(headerInfo.top, '0px', `Header top must be 0px at ${w}px`);
      assert.ok(headerInfo.height >= 56 && headerInfo.height <= 88, `Header height must be within bounds at ${w}px (got: ${headerInfo.height})`);
      console.log(`  ✓ ${w}px: position=${headerInfo.position}, top=${headerInfo.top}, z-index=${headerInfo.zIndex}, height=${headerInfo.height}px`);
    }

    // ------------------------------------------------------------------------
    // TEST 2: Desktop Navigation & Active Section Tracking (1440px)
    // ------------------------------------------------------------------------
    console.log('\n--- 2. Testing Desktop Navigation & Active Section Tracking (1440px) ---');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: `${BASE_URL}/` });
    await new Promise((r) => setTimeout(r, 1200));

    // Initial state: HOME active
    const initialActive = await cdp.eval(`
      (() => {
        const homeLink = Array.from(document.querySelectorAll('nav[aria-label="Public Navigation"] a')).find(a => a.textContent.trim() === 'HOME');
        return homeLink?.className.includes('text-toxic') || homeLink?.className.includes('bg-surface-card');
      })()
    `);
    assert.ok(initialActive, 'HOME must be active on initial homepage load');
    console.log('  ✓ Initial state: HOME navigation item is active');

    // Click HOW IT WORKS
    await cdp.eval(`
      (() => {
        const link = Array.from(document.querySelectorAll('nav[aria-label="Public Navigation"] a')).find(a => a.textContent.trim() === 'HOW IT WORKS');
        link?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1000));

    const howItWorksState = await cdp.eval(`
      (() => {
        const link = Array.from(document.querySelectorAll('nav[aria-label="Public Navigation"] a')).find(a => a.textContent.trim() === 'HOW IT WORKS');
        const section = document.getElementById('how-it-works');
        const header = document.querySelector('header');
        const heading = section?.querySelector('h2');
        const sRect = section?.getBoundingClientRect();
        const hRect = heading?.getBoundingClientRect();
        const headerRect = header?.getBoundingClientRect();
        return {
          isActive: link?.className.includes('text-toxic') && link?.className.includes('bg-surface-card'),
          headingVisibleBelowHeader: hRect && headerRect ? hRect.top >= headerRect.bottom - 5 : false,
          scrollY: window.scrollY,
        };
      })()
    `);
    assert.ok(howItWorksState.isActive, 'HOW IT WORKS must become active after click');
    assert.ok(howItWorksState.headingVisibleBelowHeader, 'HOW IT WORKS heading must not be obstructed by sticky header');
    console.log('  ✓ HOW IT WORKS clicked: active=true, heading visible below sticky header');

    // Click INCUBATOR
    await cdp.eval(`
      (() => {
        const link = Array.from(document.querySelectorAll('nav[aria-label="Public Navigation"] a')).find(a => a.textContent.trim() === 'INCUBATOR');
        link?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1000));

    const incubatorState = await cdp.eval(`
      (() => {
        const link = Array.from(document.querySelectorAll('nav[aria-label="Public Navigation"] a')).find(a => a.textContent.trim() === 'INCUBATOR');
        const section = document.getElementById('pipeline-section');
        const heading = section?.querySelector('h2');
        const header = document.querySelector('header');
        const hRect = heading?.getBoundingClientRect();
        const headerRect = header?.getBoundingClientRect();
        return {
          isActive: link?.className.includes('text-toxic') && link?.className.includes('bg-surface-card'),
          headingVisibleBelowHeader: hRect && headerRect ? hRect.top >= headerRect.bottom - 5 : false,
        };
      })()
    `);
    assert.ok(incubatorState.isActive, 'INCUBATOR must become active after click');
    assert.ok(incubatorState.headingVisibleBelowHeader, 'INCUBATOR heading must not be obstructed by sticky header');
    console.log('  ✓ INCUBATOR clicked: active=true, heading visible below sticky header');

    // Click MEMBERSHIP directly without returning to top
    await cdp.eval(`
      (() => {
        const link = Array.from(document.querySelectorAll('nav[aria-label="Public Navigation"] a')).find(a => a.textContent.trim() === 'MEMBERSHIP');
        link?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1000));

    const membershipState = await cdp.eval(`
      (() => {
        const link = Array.from(document.querySelectorAll('nav[aria-label="Public Navigation"] a')).find(a => a.textContent.trim() === 'MEMBERSHIP');
        const section = document.getElementById('choose-your-access');
        const heading = section?.querySelector('h2');
        const header = document.querySelector('header');
        const hRect = heading?.getBoundingClientRect();
        const headerRect = header?.getBoundingClientRect();
        return {
          isActive: link?.className.includes('text-toxic') && link?.className.includes('bg-surface-card'),
          headingVisibleBelowHeader: hRect && headerRect ? hRect.top >= headerRect.bottom - 5 : false,
        };
      })()
    `);
    assert.ok(membershipState.isActive, 'MEMBERSHIP must become active after direct click');
    assert.ok(membershipState.headingVisibleBelowHeader, 'MEMBERSHIP heading must not be obstructed by sticky header');
    console.log('  ✓ MEMBERSHIP clicked without returning to top: active=true, heading visible');

    // Click PERFORMANCE (routes to /ledger)
    await cdp.eval(`
      (() => {
        const link = Array.from(document.querySelectorAll('nav[aria-label="Public Navigation"] a')).find(a => a.textContent.trim() === 'PERFORMANCE');
        link?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1500));

    const ledgerState = await cdp.eval(`
      (() => {
        return {
          url: window.location.href,
          pathname: window.location.pathname,
          isPerformanceActive: document.querySelector('nav a[href="/ledger"]')?.classList.contains('text-toxic'),
          isHomeNotActive: !document.querySelector('nav a[href="/#hero-section"]')?.classList.contains('bg-surface-card'),
        };
      })()
    `);
    assert.ok(ledgerState.pathname.includes('/ledger'), 'PERFORMANCE must navigate to /ledger route');
    assert.ok(ledgerState.isPerformanceActive, 'PERFORMANCE must be highlighted on /ledger');
    assert.ok(ledgerState.isHomeNotActive, 'Landing sections must NOT be highlighted on /ledger');
    console.log('  ✓ PERFORMANCE route navigated to /ledger, active styling verified');

    // Return to landing page from /ledger by clicking INCUBATOR
    await cdp.eval(`
      (() => {
        const link = Array.from(document.querySelectorAll('nav a')).find(a => a.textContent.trim() === 'INCUBATOR');
        link?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1500));

    const returnedIncubator = await cdp.eval(`
      (() => {
        return {
          pathname: window.location.pathname,
          hash: window.location.hash,
          isIncubatorActive: Array.from(document.querySelectorAll('nav a')).find(a => a.textContent.trim() === 'INCUBATOR')?.classList.contains('bg-surface-card'),
        };
      })()
    `);
    assert.equal(returnedIncubator.pathname, '/', 'Must return to homepage');
    console.log('  ✓ Returned to /#pipeline-section from /ledger successfully');

    // ------------------------------------------------------------------------
    // TEST 3: Mobile Navigation Drawer (375px)
    // ------------------------------------------------------------------------
    console.log('\n--- 3. Testing Mobile Navigation Drawer (375px) ---');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 667,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await cdp.send('Page.navigate', { url: `${BASE_URL}/` });
    await new Promise((r) => setTimeout(r, 1200));

    // Open mobile hamburger
    await cdp.eval(`
      (() => {
        const btn = document.querySelector('button[aria-label*="Navigation Menu"]');
        btn?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));

    const drawerOpen = await cdp.eval(`
      (() => {
        const drawer = document.querySelector('.lg\\\\:hidden.border-t');
        return Boolean(drawer);
      })()
    `);
    assert.ok(drawerOpen, 'Mobile drawer must open when toggle is tapped');
    console.log('  ✓ Mobile menu drawer opened successfully');

    // Click HOW IT WORKS inside drawer
    await cdp.eval(`
      (() => {
        const drawerLinks = Array.from(document.querySelectorAll('.lg\\\\:hidden.border-t a'));
        const link = drawerLinks.find(a => a.textContent.trim() === 'HOW IT WORKS');
        link?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1000));

    const drawerClosedAfterClick = await cdp.eval(`
      (() => {
        const drawer = document.querySelector('.lg\\\\:hidden.border-t');
        const header = document.querySelector('header');
        const hamburger = document.querySelector('button[aria-label*="Navigation Menu"]');
        const headerRect = header?.getBoundingClientRect();
        return {
          drawerClosed: !drawer,
          headerSticky: header && headerRect.top === 0,
          hamburgerAccessible: Boolean(hamburger && hamburger.getBoundingClientRect().height >= 44),
          scrollY: window.scrollY,
        };
      })()
    `);
    assert.ok(drawerClosedAfterClick.drawerClosed, 'Drawer must close automatically after selecting a section');
    assert.ok(drawerClosedAfterClick.headerSticky, 'Sticky header must remain pinned at top: 0');
    assert.ok(drawerClosedAfterClick.hamburgerAccessible, 'Hamburger toggle must remain accessible');
    console.log('  ✓ Drawer closed, header remains sticky, hamburger button accessible at scroll position');

    // Select another section directly without returning to top
    await cdp.eval(`
      (() => {
        const btn = document.querySelector('button[aria-label*="Navigation Menu"]');
        btn?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));

    await cdp.eval(`
      (() => {
        const drawerLinks = Array.from(document.querySelectorAll('.lg\\\\:hidden.border-t a'));
        const link = drawerLinks.find(a => a.textContent.trim() === 'MEMBERSHIP');
        link?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1000));

    const secondSectionNav = await cdp.eval(`
      (() => {
        const drawer = document.querySelector('.lg\\\\:hidden.border-t');
        const section = document.getElementById('choose-your-access');
        const heading = section?.querySelector('h2');
        const header = document.querySelector('header');
        const hRect = heading?.getBoundingClientRect();
        const headerRect = header?.getBoundingClientRect();
        return {
          drawerClosed: !drawer,
          headingVisible: hRect && headerRect ? hRect.top >= headerRect.bottom - 5 : false,
        };
      })()
    `);
    assert.ok(secondSectionNav.drawerClosed, 'Drawer must close after second selection');
    assert.ok(secondSectionNav.headingVisible, 'Section heading must remain visible below header on mobile');
    console.log('  ✓ Mobile: Switched between sections without returning to top cleanly');

    // ------------------------------------------------------------------------
    // TEST 4: Manual Scrolling & Active Menu Updates
    // ------------------------------------------------------------------------
    console.log('\n--- 4. Testing Manual Scrolling & Scrollspy Updates ---');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // Scroll to top
    await cdp.eval(`window.scrollTo(0, 0);`);
    await new Promise((r) => setTimeout(r, 600));
    const homeActive = await cdp.eval(`
      Array.from(document.querySelectorAll('nav a')).find(a => a.textContent.trim() === 'HOME')?.classList.contains('bg-surface-card')
    `);
    assert.ok(homeActive, 'HOME must be active at scroll 0');
    console.log('  ✓ At top (scrollY=0): HOME active');

    // Scroll to #pipeline-section
    await cdp.eval(`
      const target = document.getElementById('pipeline-section');
      if (target) target.scrollIntoView();
    `);
    await new Promise((r) => setTimeout(r, 600));
    const pipeActive = await cdp.eval(`
      Array.from(document.querySelectorAll('nav a')).find(a => a.textContent.trim() === 'INCUBATOR')?.classList.contains('bg-surface-card')
    `);
    assert.ok(pipeActive, 'INCUBATOR must be active when scrolled to pipeline section');
    console.log('  ✓ Scrolled to #pipeline-section: INCUBATOR active');

    // Scroll to bottom
    await cdp.eval(`window.scrollTo(0, document.documentElement.scrollHeight);`);
    await new Promise((r) => setTimeout(r, 600));
    const memActive = await cdp.eval(`
      Array.from(document.querySelectorAll('nav a')).find(a => a.textContent.trim() === 'MEMBERSHIP')?.classList.contains('bg-surface-card')
    `);
    assert.ok(memActive, 'MEMBERSHIP must be active when scrolled to page bottom');
    console.log('  ✓ Scrolled to bottom: MEMBERSHIP active');

    // ------------------------------------------------------------------------
    // TEST 5: Footer Back to Top Functionality
    // ------------------------------------------------------------------------
    console.log('\n--- 5. Testing Footer Back to Top Functionality ---');
    // On homepage: click back to top
    await cdp.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('footer a')).find(a => a.textContent.includes('BACK TO TOP'));
        btn?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1200));

    const scrolledToTop = await cdp.eval(`window.scrollY < 200`);
    assert.ok(scrolledToTop, 'Footer BACK TO TOP on homepage must scroll back to hero section');
    console.log('  ✓ Homepage: Footer BACK TO TOP scrolled to top successfully');

    // On /ledger page: verify Back to Top links to /#hero-section
    await cdp.send('Page.navigate', { url: `${BASE_URL}/ledger` });
    await new Promise((r) => setTimeout(r, 1200));

    const subpageFooterHref = await cdp.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('footer a')).find(a => a.textContent.includes('BACK TO TOP'));
        return btn?.getAttribute('href');
      })()
    `);
    assert.equal(subpageFooterHref, '/#hero-section', 'Footer Back to Top on subpages must link to /#hero-section');
    console.log('  ✓ Subpage (/ledger): Footer BACK TO TOP links to /#hero-section (not bare anchor)');

    // ------------------------------------------------------------------------
    // TEST 6: Reduced-Motion Behavior
    // ------------------------------------------------------------------------
    console.log('\n--- 6. Testing Prefers-Reduced-Motion Behavior ---');
    await cdp.send('Emulation.setEmulatedMedia', {
      media: 'screen',
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await cdp.send('Page.navigate', { url: `${BASE_URL}/` });
    await new Promise((r) => setTimeout(r, 1000));

    const reducedMotionScrollBehavior = await cdp.eval(`
      (() => {
        const htmlStyle = window.getComputedStyle(document.documentElement);
        return {
          scrollBehavior: htmlStyle.scrollBehavior,
          matches: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        };
      })()
    `);
    assert.ok(reducedMotionScrollBehavior.matches, 'prefers-reduced-motion media query must be active');
    assert.equal(reducedMotionScrollBehavior.scrollBehavior, 'auto', 'HTML scroll-behavior must be auto under reduced-motion');
    console.log('  ✓ Prefers-reduced-motion respected: scroll-behavior=auto');

    console.log('\n======================================================');
    console.log(' ALL BROWSER INTERACTION TESTS PASSED SUCCESSFULLY! ');
    console.log('======================================================\n');
  } finally {
    if (cdp) cdp.close();
    chrome.kill();
  }
}

runBrowserTests().catch((err) => {
  console.error('\n[Browser Test Error]:', err);
  process.exit(1);
});
