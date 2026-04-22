/**
 * ContextPilot v1.0 — api_key_grabber.js
 * --------------------------------
 * Auto API key from console.anthropic.com.
 *
 *
 * GitHub: https://github.com/prasadaniket/ContextPilot
 */
const LOG = '[ContextPilot KeyGrabber]';

// ── Message Listener ──────────────────────────────────────────────────────────

/**
 * Listen for TRIGGER_GRAB from background.js.
 * background.js sends this after opening the console tab and waiting for load.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'TRIGGER_GRAB') return;

  console.log(`${LOG} Triggered — starting key capture`);

  grabApiKey()
    .then(key => {
      if (key) {
        chrome.runtime.sendMessage({ type: 'API_KEY_CAPTURED', key });
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Key not found in page' });
      }
    })
    .catch(err => {
      console.error(`${LOG} Failed:`, err);
      sendResponse({ success: false, error: err.message });
    });

  return true; // keep channel open for async
});

// ── Key Capture Flow ──────────────────────────────────────────────────────────

/**
 * grabApiKey
 * ----------
 * Main capture flow. Clicks "Create key", waits for the modal,
 * reads the key from the DOM, returns it.
 *
 * @returns {Promise<string|null>} the API key string or null
 */
async function grabApiKey() {
  // Navigate to the keys page if not already there
  if (!window.location.pathname.includes('keys')) {
    window.location.href = 'https://console.anthropic.com/settings/keys';
    await waitMs(3000);
  }

  // Find and click the "Create key" button
  const createBtn = await waitForElement([
    'button:has-text("Create Key")',
    'button:has-text("Create key")',
    '[data-testid="create-api-key"]',
    'button.create-key',
  ], 5000);

  if (!createBtn) {
    throw new Error('Could not find "Create key" button. Are you logged in?');
  }

  console.log(`${LOG} Clicking Create key button`);
  createBtn.click();

  // Wait for the modal / key display
  await waitMs(1500);

  // Look for the generated key in common locations
  const key = await extractKeyFromPage();
  return key;
}

/**
 * extractKeyFromPage
 * ------------------
 * Tries several selectors to find the API key in the modal or page.
 * Anthropic's console has changed this UI before — we try multiple selectors.
 *
 * @returns {Promise<string|null>}
 */
async function extractKeyFromPage() {
  // Wait for any key-like input to appear
  await waitMs(1000);

  // Selectors to try (in order of specificity)
  const selectors = [
    'input[readonly][value^="sk-ant-"]',
    'input[type="text"][value^="sk-ant-"]',
    '[data-testid="api-key-value"]',
    'code:contains("sk-ant-")',
    'span:contains("sk-ant-")',
    'p:contains("sk-ant-")',
  ];

  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        const val = el.value || el.textContent || '';
        const match = val.match(/sk-ant-[A-Za-z0-9\-_]+/);
        if (match) {
          console.log(`${LOG} Key captured via selector: ${sel}`);
          return match[0];
        }
      }
    } catch { /* selector may not be valid — skip */ }
  }

  // Fallback: scan all text on page for a key pattern
  const bodyText = document.body.innerText || '';
  const match = bodyText.match(/sk-ant-[A-Za-z0-9\-_]{40,}/);
  if (match) {
    console.log(`${LOG} Key captured via body scan`);
    return match[0];
  }

  console.warn(`${LOG} No key found in page`);
  return null;
}

// ── DOM Utilities ─────────────────────────────────────────────────────────────

/**
 * waitForElement
 * --------------
 * Polls for any of the provided selectors until one matches or timeout.
 * Also handles :has-text() pseudo-selectors manually.
 *
 * @param {string[]} selectors
 * @param {number}   timeoutMs
 * @returns {Promise<Element|null>}
 */
async function waitForElement(selectors, timeoutMs = 5000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    for (const sel of selectors) {
      try {
        // Handle :has-text() pseudo-selector
        if (sel.includes(':has-text(')) {
          const [tag, text] = sel.split(':has-text(');
          const needle = text.replace(/["')]/g, '').trim();
          const els = document.querySelectorAll(tag.trim());
          for (const el of els) {
            if (el.textContent.includes(needle)) return el;
          }
        } else {
          const el = document.querySelector(sel);
          if (el) return el;
        }
      } catch { /* invalid selector — skip */ }
    }
    await waitMs(200);
  }

  return null;
}

/**
 * waitMs
 * ------
 * Simple promise-based delay.
 *
 * @param {number} ms
 */
function waitMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

console.log(`${LOG} Key grabber ready on ${window.location.hostname}`);
