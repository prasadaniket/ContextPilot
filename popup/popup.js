document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadCompressionStats(), loadUsageData(), loadApiKeyStatus()]);
  bindEvents();
});

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

async function loadUsageData() {
  try {
    const stored = await chrome.storage.local.get([
      'cp_session_usage', 'cp_weekly_usage',
      'cp_session_reset_ms', 'cp_weekly_reset_ms',
      'cp_token_count', 'cp_cache_expires'
    ]);

    const tokens = stored.cp_token_count ?? 0;
    set('tokenCount', `${formatK(tokens)} / 200K tokens`);
    setBar('tokenBar', Math.min(100, Math.round((tokens / 200_000) * 100)));

    if (stored.cp_session_usage != null) {
      const p = Math.round(stored.cp_session_usage * 100);
      set('sessionPct', `${p}%`);
      setBar('sessionBar', p);
      if (stored.cp_session_reset_ms > 0) {
        set('sessionReset', `resets in ${formatMs(stored.cp_session_reset_ms)}`);
      }
    }

    if (stored.cp_weekly_usage != null) {
      const p = Math.round(stored.cp_weekly_usage * 100);
      set('weeklyPct', `${p}%`);
      setBar('weeklyBar', p);
      if (stored.cp_weekly_reset_ms > 0) {
        set('weeklyReset', `resets in ${formatMs(stored.cp_weekly_reset_ms)}`);
      }
    }

    if (stored.cp_cache_expires) {
      const rem = stored.cp_cache_expires - Date.now();
      set('cacheTimer', rem > 0 ? formatMs(rem) : 'expired');
    }
  } catch (err) {
    console.warn('[ContextPilot Popup] loadUsageData:', err.message);
  }
}

async function loadApiKeyStatus() {
  try {
    const { isSet, maskedKey } = await msg({ type: 'GET_API_KEY_STATUS' });
    const input = document.getElementById('apiInput');
    if (isSet) {
      input.placeholder = maskedKey;
      showStatus('API key set — full compression active', 'ok');
    } else {
      showStatus('No API key — using basic compression fallback', '');
    }
  } catch { /* ignore */ }
}

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

  document.getElementById('grabBtn').addEventListener('click', async () => {
    const btn = document.getElementById('grabBtn');
    btn.textContent = 'Opening console…';
    btn.disabled = true;
    try {
      const result = await msg({ type: 'GRAB_API_KEY' });
      if (result?.success) {
        showStatus('Check the Anthropic console tab — key will be saved automatically', 'ok');
      } else {
        showStatus(result?.error ?? 'Could not open console', 'err');
        btn.textContent = '✳ Get key automatically';
        btn.disabled = false;
      }
    } catch (e) {
      showStatus('Error: ' + e.message, 'err');
      btn.textContent = '✳ Get key automatically';
      btn.disabled = false;
    }
    setTimeout(() => {
      btn.textContent = '✳ Get key automatically';
      btn.disabled = false;
    }, 8000);
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
