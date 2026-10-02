/**
 * Automated Universal Theme Test Suite (Single Page Navigation & Multi-Tab Real-Time Sync)
 */

const { spawn } = require('child_process');
const http = require('http');

const PORT = 9230;
const PROFILE_DIR = '/tmp/chrome-test-universal-theme-' + Date.now();
const BASE_URL = 'http://localhost:8089';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch(e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();

    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = msg => {
      const res = JSON.parse(msg.data);
      if (res.id && this.callbacks.has(res.id)) {
        this.callbacks.get(res.id)(res);
        this.callbacks.delete(res.id);
      }
    };
  }

  send(method, params = {}) {
    const id = this.id++;
    return new Promise(resolve => {
      this.callbacks.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res && res.result && res.result.result) {
      return res.result.result.value;
    }
    return null;
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await sleep(600);
  }
}

async function run() {
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║        ⚡ WHAT THE BUG — UNIVERSAL THEME & MULTI-TAB SYNC TEST              ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

  console.log('🚀 Starting headless Chrome instance on port ' + PORT + '...');
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--disable-gpu',
    `${BASE_URL}/index.html`
  ]);

  let cdp = null;

  try {
    let connected = false;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      try {
        const pages = await httpGetJson(`http://127.0.0.1:${PORT}/json/list`);
        const targetPage = pages.find(p => p.type === 'page' && p.url.includes('8089'));
        if (targetPage && targetPage.webSocketDebuggerUrl) {
          cdp = new CDPClient(targetPage.webSocketDebuggerUrl);
          await cdp.ready;
          connected = true;
          break;
        }
      } catch(e) {}
    }

    if (!connected) {
      throw new Error('Could not connect to Headless Chrome page CDP');
    }

    console.log('✔ Connected to Headless Chrome Page CDP.\n');
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    const tests = [
      {
        step: '1. Select [Pure Light] on Main Dashboard (index.html)',
        url: `${BASE_URL}/index.html`,
        action: async () => {
          await cdp.eval(`ThemeManager.setTheme('light')`);
        },
        expectedTheme: 'light'
      },
      {
        step: '2. Navigate to Training Academy (training.html) -> Verify Light theme inherited',
        url: `${BASE_URL}/training.html`,
        action: null,
        expectedTheme: 'light'
      },
      {
        step: '3. Select [Nord Frost] on Training Academy (training.html)',
        url: `${BASE_URL}/training.html`,
        action: async () => {
          await cdp.eval(`ThemeManager.setTheme('nord')`);
        },
        expectedTheme: 'nord'
      },
      {
        step: '4. Navigate to SystemVerilog Course (training/sv_course.html) -> Verify Nord Frost inherited',
        url: `${BASE_URL}/training/sv_course.html`,
        action: null,
        expectedTheme: 'nord'
      },
      {
        step: '5. Select [Dracula Pro] on SystemVerilog Course (sv_course.html)',
        url: `${BASE_URL}/training/sv_course.html`,
        action: async () => {
          await cdp.eval(`SVApp.setTheme('dracula')`);
        },
        expectedTheme: 'dracula'
      },
      {
        step: '6. Navigate to Custom Playground (custom_playground.html) -> Verify Dracula inherited',
        url: `${BASE_URL}/custom_playground.html`,
        action: null,
        expectedTheme: 'dracula'
      },
      {
        step: '7. Select [Batman Dark Knight] on Custom Playground (custom_playground.html)',
        url: `${BASE_URL}/custom_playground.html`,
        action: async () => {
          await cdp.eval(`ThemeManager.setTheme('batman')`);
        },
        expectedTheme: 'batman'
      },
      {
        step: '8. Navigate to UVM Course (training/uvm_course.html) -> Verify Batman inherited',
        url: `${BASE_URL}/training/uvm_course.html`,
        action: null,
        expectedTheme: 'batman'
      },
      {
        step: '9. Select [One Dark Pro] on UVM Course (uvm_course.html)',
        url: `${BASE_URL}/training/uvm_course.html`,
        action: async () => {
          await cdp.eval(`App.setTheme('onedark')`);
        },
        expectedTheme: 'onedark'
      },
      {
        step: '10. Navigate to Dataset Manager (dataset_manager.html) -> Verify One Dark Pro inherited',
        url: `${BASE_URL}/dataset_manager.html`,
        action: null,
        expectedTheme: 'onedark'
      },
      {
        step: '11. Navigate to Waveform Sandbox (waveform_demo.html) -> Verify One Dark Pro retained',
        url: `${BASE_URL}/waveform_demo.html`,
        action: null,
        expectedTheme: 'onedark'
      },
      {
        step: '12. Navigate back to Main Dashboard (index.html) -> Verify One Dark Pro retained',
        url: `${BASE_URL}/index.html`,
        action: null,
        expectedTheme: 'onedark'
      },
      {
        step: '13. Select [GitHub Dark (Default)] on index.html',
        url: `${BASE_URL}/index.html`,
        action: async () => {
          await cdp.eval(`ThemeManager.setTheme('github')`);
        },
        expectedTheme: 'github'
      },
      {
        step: '14. Navigate to Practical UVM Book (training/practical_uvm_book.html) -> Verify GitHub Dark inherited',
        url: `${BASE_URL}/training/practical_uvm_book.html`,
        action: null,
        expectedTheme: 'github'
      }
    ];

    let passedCount = 0;

    for (const t of tests) {
      process.stdout.write(`▶ ${t.step}... `);
      await cdp.navigate(t.url);

      if (t.action) {
        await t.action();
        await sleep(150);
      }

      const activeTheme = await cdp.eval(`document.documentElement.getAttribute('data-theme')`);
      const storedWtbTheme = await cdp.eval(`localStorage.getItem('wtb_theme')`);

      const domMatches = activeTheme === t.expectedTheme;
      const storageMatches = storedWtbTheme === t.expectedTheme;

      if (domMatches && storageMatches) {
        console.log(`✔ PASS [data-theme="${activeTheme}", storage="${storedWtbTheme}"]`);
        passedCount++;
      } else {
        console.log(`✖ FAIL [DOM: "${activeTheme}", Storage: "${storedWtbTheme}", Expected: "${t.expectedTheme}"]`);
      }
    }

    // ─── Test 15: Cross-Tab Real-Time Sync Test ───
    process.stdout.write(`▶ 15. Real-Time Cross-Tab Sync (Tab 1 sets [Pure Light], Tab 2 auto-updates)... `);
    
    // Create Tab 2 via CDP
    const targetRes = await cdp.send('Target.createTarget', { url: `${BASE_URL}/training/sv_course.html` });
    const targetId = (targetRes.result && targetRes.result.targetId) || targetRes.targetId;
    await cdp.send('Target.activateTarget', { targetId });
    await sleep(1000);
    const pages = await httpGetJson(`http://127.0.0.1:${PORT}/json/list`);
    const tab2Info = pages.find(p => p.id === targetId);
    const cdpTab2 = new CDPClient(tab2Info.webSocketDebuggerUrl);
    await cdpTab2.ready;
    await cdpTab2.send('Page.enable');
    await cdpTab2.send('Runtime.enable');
    await sleep(600);

    // Tab 1 sets theme to 'light'
    await cdp.eval(`ThemeManager.setTheme('light')`);
    await sleep(600);

    // Tab 2 should automatically have updated its DOM attribute via the window 'storage' listener without reload!
    const tab2Theme = await cdpTab2.eval(`document.documentElement.getAttribute('data-theme')`);
    if (tab2Theme === 'light') {
      console.log(`✔ PASS [Tab 2 instantly reacted via storage event: data-theme="${tab2Theme}"]`);
      passedCount++;
    } else {
      console.log(`✖ FAIL [Tab 2 did not react: data-theme="${tab2Theme}"]`);
    }

    // Tab 2 sets theme to 'nord'
    process.stdout.write(`▶ 16. Real-Time Cross-Tab Sync (Tab 2 sets [Nord Frost], Tab 1 auto-updates)... `);
    await cdpTab2.eval(`SVApp.setTheme('nord')`);
    await sleep(300);

    const tab1Theme = await cdp.eval(`document.documentElement.getAttribute('data-theme')`);
    if (tab1Theme === 'nord') {
      console.log(`✔ PASS [Tab 1 instantly reacted via storage event: data-theme="${tab1Theme}"]`);
      passedCount++;
    } else {
      console.log(`✖ FAIL [Tab 1 did not react: data-theme="${tab1Theme}"]`);
    }

    const totalTests = tests.length + 2;

    console.log('\n══════════════════════════════════════════════════════════════════════════════');
    console.log(` TEST SUMMARY: ${passedCount} / ${totalTests} Universal Theme Tests Passed`);
    console.log('══════════════════════════════════════════════════════════════════════════════\n');

    if (passedCount === totalTests) {
      console.log('✨ ALL THEMES ARE FULLY UNIVERSAL AND SYNCHRONIZED ACROSS ALL PAGES & TABS!');
      process.exit(0);
    } else {
      process.exit(1);
    }

  } catch(err) {
    console.error('Test execution failed:', err);
    process.exit(1);
  } finally {
    if (chrome) {
      chrome.kill();
    }
  }
}

run();
