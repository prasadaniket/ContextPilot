/**
 * ContextPilot v1.0 — cp_commands.js
 * --------------------------------
 * /cp slash command router (GSD pattern).
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
const LOG = '[ContextPilot /cp]';

// ── State shared with content_script.js ───────────────────────────────────────
// These are set/read by command handlers and checked during fetch interception
export const cpState = {
  skipNext: false,         // skip compression on the very next message
  paused: false,           // compression globally paused
  contextDepth: 2,         // how many nodes to inject (light=1, normal=2, deep=3)
  sidebarOpen: false,      // whether the D3 tree panel is visible
};

// ── Command Router ─────────────────────────────────────────────────────────────

/**
 * routeCpCommand
 * --------------
 * Main entry point. Receives the raw /cp text from content_script.js
 * and dispatches to the correct handler.
 *
 * @param {string} raw - the full /cp command text the user typed
 */
export async function routeCpCommand(raw) {
  const parts = raw.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  console.log(`${LOG} Command: ${cmd}`, args);

  switch (cmd) {
    case '/cp':
    case '/cp-status':
      return cmdStatus();

    case '/cp-tree':
      return cmdTree();

    case '/cp-skip':
      return cmdSkip();

    case '/cp-pause':
      return cmdPause();

    case '/cp-resume':
      return cmdResume();

    case '/cp-reset':
      return cmdReset();

    case '/cp-export':
      return cmdExport();

    case '/cp-mode':
      return cmdMode(args[0]);

    case '/cp-help':
      return cmdHelp();

    default:
      injectSystemMessage(`Unknown command: ${cmd}\nType /cp-help to see all commands.`);
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * cmdStatus
 * ---------
 * Fetches current stats and injects a formatted status message into the chat.
 */
async function cmdStatus() {
  const stats = await sendToBg({ type: 'GET_STATS' });
  const { cp_session_usage, cp_weekly_usage, cp_cache_expires, cp_token_count }
    = await chrome.storage.local.get([
        'cp_session_usage', 'cp_weekly_usage', 'cp_cache_expires', 'cp_token_count'
      ]);

  const cacheRem = cp_cache_expires ? Math.max(0, cp_cache_expires - Date.now()) : 0;

  const text = [
    'ContextPilot v1.0 — current session',
    '─'.repeat(38),
    `Nodes in tree:    ${stats?.totalNodes ?? 0}`,
    `Tokens saved:     ${fmt(stats?.tokensSaved ?? 0)}`,
    `Compression:      ${stats?.compressionRatio ?? 0}%`,
    `Context tokens:   ${fmt(cp_token_count ?? 0)} / 200K`,
    `Session usage:    ${pct(cp_session_usage)}`,
    `Weekly usage:     ${pct(cp_weekly_usage)}`,
    `Cache expires:    ${fmtMs(cacheRem)}`,
    `Mode:             depth-${cpState.contextDepth}`,
    `Status:           ${cpState.paused ? 'PAUSED' : 'active'}`,
    '─'.repeat(38),
    'Type /cp-help for all commands',
  ].join('\n');

  injectSystemMessage(text);
}

/**
 * cmdTree
 * -------
 * Toggles the D3 graph sidebar panel.
 */
function cmdTree() {
  const panel = document.getElementById('cp-sidebar');
  if (panel) {
    cpState.sidebarOpen = !cpState.sidebarOpen;
    panel.style.display = cpState.sidebarOpen ? 'flex' : 'none';
    // Adjust main chat width
    const main = document.querySelector('main') ?? document.body;
    main.style.paddingRight = cpState.sidebarOpen ? '290px' : '';
  } else {
    // Panel not yet injected — trigger tree_panel.js
    import(chrome.runtime.getURL('graph/tree_panel.js'))
      .then(module => module.openPanel())
      .catch(err => console.error('[ContextPilot] Failed to load tree panel:', err));
  }
}

/**
 * cmdSkip
 * -------
 * Skips compression for the NEXT message only.
 */
function cmdSkip() {
  cpState.skipNext = true;
  injectSystemMessage('ContextPilot: next message will NOT be compressed or injected with context.');
}

/**
 * cmdPause
 * --------
 * Pauses all compression until resumed.
 */
function cmdPause() {
  cpState.paused = true;
  injectSystemMessage('ContextPilot: compression PAUSED. Type /cp-resume to restart.');
}

/**
 * cmdResume
 * ---------
 * Resumes compression.
 */
function cmdResume() {
  cpState.paused = false;
  injectSystemMessage('ContextPilot: compression resumed.');
}

/**
 * cmdReset
 * --------
 * Clears the tree for the current conversation.
 */
async function cmdReset() {
  const convId = getCurrentConversationId();
  if (!convId) {
    injectSystemMessage('ContextPilot: could not detect current conversation ID.');
    return;
  }
  await sendToBg({ type: 'CLEAR_CONVERSATION', payload: { conversationId: convId } });
  injectSystemMessage('ContextPilot: conversation tree cleared. Starting fresh.');
}

/**
 * cmdExport
 * ---------
 * Downloads the current conversation tree as a JSON file.
 */
async function cmdExport() {
  const convId = getCurrentConversationId();
  const data = await sendToBg({ type: 'EXPORT_CONVERSATION', payload: { conversationId: convId } });

  if (!data?.nodes) {
    injectSystemMessage('ContextPilot: no data to export yet.');
    return;
  }

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cp-tree-${convId}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  injectSystemMessage(`ContextPilot: exported ${data.nodes.length} nodes.`);
}

/**
 * cmdMode
 * -------
 * Sets the context injection depth.
 *
 * @param {string} mode - 'light' | 'deep' | undefined (defaults to normal)
 */
function cmdMode(mode) {
  switch ((mode || '').toLowerCase()) {
    case 'light': cpState.contextDepth = 1; break;
    case 'deep':  cpState.contextDepth = 3; break;
    default:      cpState.contextDepth = 2; break;
  }
  const names = { 1: 'light (1 node)', 2: 'normal (2 nodes)', 3: 'deep (3 nodes)' };
  injectSystemMessage(`ContextPilot: mode set to ${names[cpState.contextDepth]}.`);
}

/**
 * cmdHelp
 * -------
 * Injects a formatted help message into the chat.
 */
function cmdHelp() {
  const text = [
    'ContextPilot v1.0 — available commands',
    '─'.repeat(40),
    '/cp              Show current status',
    '/cp-status       Same as /cp',
    '/cp-tree         Toggle the D3 graph sidebar',
    '/cp-skip         Skip compression for next message',
    '/cp-pause        Pause all compression',
    '/cp-resume       Resume compression',
    '/cp-reset        Clear tree for this conversation',
    '/cp-export       Download tree as JSON',
    '/cp-mode light   Use only 1 past node as context',
    '/cp-mode deep    Use 3 past nodes as context',
    '/cp-help         Show this message',
    '─'.repeat(40),
    'These commands are handled locally — never sent to Claude.',
  ].join('\n');

  injectSystemMessage(text);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * injectSystemMessage
 * -------------------
 * Injects a formatted message into the chat UI to appear as if
 * ContextPilot itself is speaking. Displayed in a distinctive style.
 *
 * @param {string} text - message content
 */
function injectSystemMessage(text) {
  // Find Claude's message list container
  const list = document.querySelector('[data-testid="conversation-content"]')
             ?? document.querySelector('div.flex-col.gap-3');

  if (!list) {
    console.log(`${LOG} Output:`, text);
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    margin: 8px 0; padding: 10px 14px;
    background: rgba(83,74,183,0.06);
    border-left: 3px solid #534AB7;
    border-radius: 0 6px 6px 0;
    font-family: monospace; font-size: 12px;
    white-space: pre; color: var(--color-text-secondary, #555);
  `;
  wrapper.textContent = text;
  list.appendChild(wrapper);
  wrapper.scrollIntoView({ behavior: 'smooth', block: 'end' });

  // Auto-remove after 30 seconds
  setTimeout(() => wrapper.remove(), 30_000);
}

/**
 * getCurrentConversationId
 * -------------------------
 * Extracts the conversation UUID from the current URL.
 *
 * @returns {string|null}
 */
function getCurrentConversationId() {
  const m = window.location.href.match(/\/chat\/([a-f0-9-]+)/);
  return m ? `conv_${m[1]}` : null;
}

function sendToBg(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, res => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res);
    });
  });
}

function fmt(n) { return n >= 1000 ? `${(n/1000).toFixed(1)}K` : String(n || 0); }
function pct(f) { return f != null ? `${Math.round(f * 100)}%` : '—'; }
function fmtMs(ms) {
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
  return ms <= 0 ? 'expired' : m > 0 ? `${m}m ${s}s` : `${s}s`;
}
