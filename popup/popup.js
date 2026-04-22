/**
 * ContextPilot v1.0 — popup.js
 * --------------------------------
 * Reads tree stats, renders dashboard.
 *
 * Sources:
 *   Display layer adapted from claude-counter by she-llac (MIT)
 *   https://github.com/she-llac/claude-counter
 *
 *   Command pattern adapted from get-shit-done by gsd-build (MIT)
 *   https://github.com/gsd-build/get-shit-done
 *
 *   Graph visualization adapted from code-review-graph by tirth8205 (MIT)
 *   https://github.com/tirth8205/code-review-graph
 *
 * GitHub: https://github.com/prasadaniket/ContextPilot
 */
document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadCompressionStats(), loadUsageData(), loadApiKeyStatus()]);
  bindEvents();
});

// ─── Compression stats (ContextPilot) ────────────────────────────────────────

/**
 * loadCompressionStats
 * --------------------
 * Fetches tree stats from background.js and renders the compression section.
 */
async function loadCompressionStats() {
  try {
    const stats = await msg({ type: 'GET_STATS' });
    if (!stats || stats.error) return;

    set('tokensSaved',      formatK(stats.tokensSaved));
    set('compressionRatio', stats.compressionRatio > 0 ? `${stats.compressionRatio}%` : '—');
    set('totalNodes',       formatK(stats.totalNodes));
    set('chatCount',        formatK(stats.conversationCount));
  } catch (err) {
    console.warn('[ContextPilot Popup] loadCompressionStats:', err.message);
  }
}

// ─── Live usage data (claude-counter layer) ───────────────────────────────────

/**
 * loadUsageData
 * -------------
 * Reads live usage state written to chrome.storage.local by content_script.js.
 * The content script writes state after each SSE stream so the popup can read it.
 * Falls back to querying Claude's /usage endpoint directly if storage is empty.
 */
async function loadUsageData() {
  try {
    const stored = await chrome.storage.local.get([
      'cp_session_usage', 'cp_weekly_usage',
      'cp_session_reset', 'cp_weekly_reset',
      'cp_token_count',   'cp_cache_expires'
    ]);

    // Token count + bar
    const tokens = stored.cp_token_count ?? 0;
    set('tokenCount', `${formatK(tokens)} / 200K tokens`);
    setBar('tokenBar', Math.min(100, Math.round((tokens / 200_000) * 100)));

    // Session usage
    if (stored.cp_session_usage != null) {
      const p = Math.round(stored.cp_session_usage * 100);
      set('sessionPct', `${p}%`);
      setBar('sessionBar', p);
      if (stored.cp_session_reset > 0) {
        set('sessionReset', `resets in ${formatMs(stored.cp_session_reset)}`);
      }
    }

    // Weekly usage
    if (stored.cp_weekly_usage != null) {
      const p = Math.round(stored.cp_weekly_usage * 100);
      set('weeklyPct', `${p}%`);
      setBar('weeklyBar', p);
      if (stored.cp_weekly_reset > 0) {
        set('weeklyReset', `resets in ${formatMs(stored.cp_weekly_reset)}`);
      }
    }

    // Cache timer
    if (stored.cp_cache_expires) {
      const rem = stored.cp_cache_expires - Date.now();
      set('cacheTimer', rem > 0 ? formatMs(rem) : 'expired');
    }

  } catch (err) {
    console.warn('[ContextPilot Popup] loadUsageData:', err.message);
  }
}

// ─── API key ──────────────────────────────────────────────────────────────────

async function loadApiKeyStatus() {
  try {
    const { isSet, maskedKey } = await msg({ type: 'GET_API_KEY_STATUS' });
    const input = document.getElementById('apiInput');
    if (isSet) {
      input.placeholder = maskedKey;
      showStatus('API key is set — full compression active', 'ok');
    } else {
      showStatus('No API key — using basic compression fallback', '');
    }
  } catch { /* ignore */ }
}

// ─── Events ───────────────────────────────────────────────────────────────────

function bindEvents() {
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const key = document.getElementById('apiInput').value.trim();
    if (!key) { showStatus('Enter your API key first', 'err'); return; }

    const result = await msg({ type: 'SAVE_API_KEY', payload: { apiKey: key } });
    if (result?.success) {
      document.getElementById('apiInput').value = '';
      showStatus('Saved', 'ok');
      await loadApiKeyStatus();
    } else {
      showStatus(result?.error ?? 'Failed to save', 'err');
    }
  });

  document.getElementById('clearBtn').addEventListener('click', async () => {
    if (!confirm('Clear all ContextPilot data? This cannot be undone.')) return;
    const result = await msg({ type: 'CLEAR_ALL' });
    if (result?.success) {
      await loadCompressionStats();
      showStatus('All data cleared', 'ok');
    }
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function msg(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, res => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res);
    });
  });
}

function set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setBar(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = `${Math.min(100, pct)}%`;
}

function showStatus(text, cls) {
  const el = document.getElementById('apiStatus');
  el.textContent = text;
  el.className = `api-status ${cls}`;
}

function formatK(n) {
  if (!n) return '0';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

function formatMs(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
