/**
 * ContextPilot — popup.js
 * --------------------------
 * Renders merged live usage plus compression metrics and handles settings actions.
 * Part of the ContextPilot Chrome Extension.
 * GitHub: https://github.com/YOUR_USERNAME/context-pilot
 */

let liveSnapshot = null;

/**
 * sendMessage
 * -----------
 * Sends a message to background and resolves with its response.
 *
 * @param {Object} message - Message payload.
 * @returns {Promise<Object>} Response object.
 */
async function sendMessage(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    console.error('[ContextPilot] popup sendMessage failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * setStatus
 * -----------
 * Displays a status string in the popup footer.
 *
 * @param {string} text - Status message.
 * @returns {void} No return value.
 */
function setStatus(text) {
  document.getElementById('statusText').textContent = text || '';
}

/**
 * formatCountdown
 * -----------
 * Formats a future epoch timestamp into a compact countdown string.
 *
 * @param {number|null} epochMs - Future timestamp in milliseconds.
 * @returns {string} Countdown text.
 */
function formatCountdown(epochMs) {
  try {
    if (!Number.isFinite(epochMs)) {
      return '--';
    }
    const delta = epochMs - Date.now();
    if (delta <= 0) {
      return '0s';
    }
    const seconds = Math.floor(delta / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    }
    return `${secs}s`;
  } catch (_error) {
    return '--';
  }
}

/**
 * renderLiveUsage
 * -----------
 * Renders live usage and cache metrics in the top section.
 *
 * @param {Object} metrics - Live metrics payload from background.
 * @returns {void} No return value.
 */
function renderLiveUsage(metrics) {
  document.getElementById('sessionUsage').textContent = Number.isFinite(metrics?.sessionUsagePct)
    ? `${metrics.sessionUsagePct}%`
    : '--%';
  document.getElementById('weeklyUsage').textContent = Number.isFinite(metrics?.weeklyUsagePct)
    ? `${metrics.weeklyUsagePct}%`
    : '--%';
  document.getElementById('cacheTimer').textContent = formatCountdown(metrics?.cacheUntil);
  document.getElementById('liveTokens').textContent = String(metrics?.tokenCount || 0);
}

/**
 * loadLiveUsage
 * -----------
 * Fetches latest live usage metrics from background and renders them.
 *
 * @returns {Promise<void>} Resolves when UI updates complete.
 */
async function loadLiveUsage() {
  try {
    const response = await sendMessage({ type: 'GET_LIVE_USAGE' });
    if (!response || response.error) {
      setStatus(response?.error || 'Failed to load live usage.');
      return;
    }
    liveSnapshot = response;
    renderLiveUsage(response);
  } catch (error) {
    console.error('[ContextPilot] loadLiveUsage failed:', error);
    setStatus('Failed to load live usage.');
  }
}

/**
 * loadStats
 * -----------
 * Fetches and renders aggregate compression statistics.
 *
 * @returns {Promise<void>} Resolves when UI values are updated.
 */
async function loadStats() {
  try {
    const stats = await sendMessage({ type: 'GET_STATS' });
    if (!stats || stats.error) {
      setStatus(stats?.error || 'Failed to load stats.');
      return;
    }

    document.getElementById('tokensSaved').textContent = String(stats.tokensSaved || 0);
    document.getElementById('nodesStored').textContent = String(stats.totalNodes || 0);
    document.getElementById('conversations').textContent = String(stats.conversations || 0);
    document.getElementById('compressionRatio').textContent = `${stats.compressionRatio || 0}%`;
  } catch (error) {
    console.error('[ContextPilot] loadStats failed:', error);
    setStatus('Failed to load stats.');
  }
}

/**
 * loadApiKey
 * -----------
 * Loads masked API key status and updates input placeholder.
 *
 * @returns {Promise<void>} Resolves when API key state is shown.
 */
async function loadApiKey() {
  try {
    const response = await sendMessage({ type: 'GET_API_KEY' });
    if (response?.hasKey) {
      document.getElementById('apiKeyInput').placeholder = response.maskedKey;
      setStatus('API key configured.');
    } else {
      setStatus('API key not set.');
    }
  } catch (error) {
    console.error('[ContextPilot] loadApiKey failed:', error);
    setStatus('Failed to load API key state.');
  }
}

/**
 * saveApiKey
 * -----------
 * Persists API key to chrome.storage.local through background message.
 *
 * @returns {Promise<void>} Resolves after save attempt completes.
 */
async function saveApiKey() {
  try {
    const input = document.getElementById('apiKeyInput');
    const apiKey = input.value.trim();
    if (!apiKey) {
      setStatus('Enter an API key first.');
      return;
    }

    const response = await sendMessage({
      type: 'SAVE_API_KEY',
      payload: { apiKey }
    });
    if (response?.success) {
      input.value = '';
      setStatus('API key saved.');
      await loadApiKey();
    } else {
      setStatus(response?.error || 'Failed to save API key.');
    }
  } catch (error) {
    console.error('[ContextPilot] saveApiKey failed:', error);
    setStatus('Failed to save API key.');
  }
}

/**
 * clearAllData
 * -----------
 * Clears all stored nodes after explicit user confirmation.
 *
 * @returns {Promise<void>} Resolves after delete and refresh.
 */
async function clearAllData() {
  try {
    const confirmed = window.confirm('Clear all ContextPilot data?');
    if (!confirmed) {
      return;
    }

    const response = await sendMessage({ type: 'CLEAR_ALL' });
    if (response?.success) {
      setStatus('All data cleared.');
      await loadStats();
    } else {
      setStatus(response?.error || 'Failed to clear data.');
    }
  } catch (error) {
    console.error('[ContextPilot] clearAllData failed:', error);
    setStatus('Failed to clear data.');
  }
}

/**
 * startCountdownTicker
 * -----------
 * Refreshes countdown labels every second without polling background.
 *
 * @returns {void} No return value.
 */
function startCountdownTicker() {
  setInterval(() => {
    if (liveSnapshot) {
      renderLiveUsage(liveSnapshot);
    }
  }, 1000);
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    document.getElementById('saveApiKeyBtn').addEventListener('click', saveApiKey);
    document.getElementById('clearAllBtn').addEventListener('click', clearAllData);
    await loadLiveUsage();
    await loadStats();
    await loadApiKey();
    startCountdownTicker();
  } catch (error) {
    console.error('[ContextPilot] popup init failed:', error);
  }
});
