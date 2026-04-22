/**
 * ContextPilot v1.0 — content_script.js
 * --------------------------------
 * Injected into claude.ai: fetch interceptor and UI HUD.
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
const LOG = '[ContextPilot]';

const COMPLETION_PATTERN = /\/api\/organizations\/.*\/chat_conversations\/.*\/completion/;
const CONTEXT_LIMIT_TOKENS = 200_000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Shared live state ─────────────────────────────────────────────────────────
const state = {
  tokenCount:       0,
  sessionUsage:     null,
  weeklyUsage:      null,
  sessionResetMs:   null,
  weeklyResetMs:    null,
  cacheExpiresAt:   null,
  tokensSaved:      0,
  nodesStored:      0,
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. FETCH INTERCEPTOR
// ─────────────────────────────────────────────────────────────────────────────

const _originalFetch = window.fetch.bind(window);

/**
 * window.fetch override
 * ----------------------
 * Transparent for all non-Claude requests.
 * For Claude's completion endpoint:
 *   (a) Swaps the payload with a lean compressed-context version
 *   (b) Taps the SSE response stream for both display parsing and compression
 */
window.fetch = async function (url, options = {}) {
  const urlStr = typeof url === 'string' ? url : (url?.url ?? '');

  if (!COMPLETION_PATTERN.test(urlStr) || options?.method !== 'POST') {
    return _originalFetch(url, options);
  }

  console.log(`${LOG} Intercepted:`, urlStr);

  let originalBody = null;
  let userMessage = '';

  // (a) Swap payload with compressed tree context
  try {
    originalBody = JSON.parse(options.body);
    userMessage = extractUserMessage(originalBody);
    const conversationId = extractConversationId(urlStr);

    const leanPayload = await sendMessage({
      type: 'GET_LEAN_CONTEXT',
      payload: { originalBody, userMessage, conversationId }
    });

    if (leanPayload) {
      options.body = JSON.stringify(leanPayload);
      console.log(`${LOG} Lean payload injected`);
    }
  } catch (err) {
    // NEVER break Claude — fall through to original
    console.warn(`${LOG} Payload swap failed, using original:`, err.message);
    if (originalBody) options.body = JSON.stringify(originalBody);
  }

  const response = await _originalFetch(url, options);

  // (b) Clone stream: Claude's UI reads uiResponse; we read tapResponse
  const [uiResponse, tapResponse] = response.tee();

  readSSEStream(tapResponse, {
    userMessage,
    conversationId: extractConversationId(urlStr),
    rawBody: originalBody,
  });

  return uiResponse;
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. SSE STREAM READER (merged — one pass, two purposes)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * readSSEStream
 * -------------
 * Reads the SSE response in one pass, extracting:
 *   • message_limit events → session/weekly usage fractions (display)
 *   • text_delta events    → assistant response text (compression)
 *
 * @param {Response} response - cloned response stream to read
 * @param {object}   meta     - { userMessage, conversationId, rawBody }
 */
async function readSSEStream(response, { userMessage, conversationId, rawBody }) {
  try {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let assistantText = '';
    let done = false;

    while (!done) {
      const { value, done: streamDone } = await reader.read();
      done = streamDone;
      if (!value) continue;

      const chunk = decoder.decode(value, { stream: true });

      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') { done = true; break; }

        let evt;
        try { evt = JSON.parse(raw); } catch { continue; }

        // Display: session/weekly usage fractions
        if (evt?.type === 'message_limit') {
          parseMessageLimit(evt);
        }

        // Compression: accumulate the assistant's full reply
        if (evt?.delta?.type === 'text_delta' && evt?.delta?.text) {
          assistantText += evt.delta.text;
        }
      }
    }

    // Stream done — update cache timer
    state.cacheExpiresAt = Date.now() + CACHE_TTL_MS;

    // Recount tokens for the conversation (accurate, using vendored tokenizer)
    if (rawBody) countConversationTokens(rawBody, assistantText);

    // Trigger background compression of this exchange
    if (assistantText && userMessage) {
      const result = await sendMessage({
        type: 'COMPRESS_EXCHANGE',
        payload: { userMessage, assistantMessage: assistantText, conversationId }
      });
      if (result?.success) await refreshCompressionStats();
    }

    updateHUD();

  } catch (err) {
    console.warn(`${LOG} SSE read error:`, err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. MESSAGE_LIMIT PARSING (from claude-counter)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * parseMessageLimit
 * -----------------
 * Extracts exact unrounded usage fractions from Claude's message_limit SSE event.
 * More accurate than the /usage page which only shows rounded percentages.
 * Adapted from claude-counter by she-llac.
 *
 * @param {object} evt - parsed SSE event with type 'message_limit'
 */
function parseMessageLimit(evt) {
  try {
    // Claude's message_limit structure varies slightly by version
    // Try the nested limits object first, then flat fields
    const limits = evt?.limits ?? evt?.message_limit ?? {};

    for (const [key, val] of Object.entries(limits)) {
      if (!val || typeof val !== 'object') continue;

      const fraction = val.fraction
        ?? (val.used != null && val.limit ? val.used / val.limit : null);
      const resetsAt = val.resets_at ?? val.resetsAt ?? null;

      const isWeekly = key.includes('week') || key.includes('7_day') || key === 'w';

      if (isWeekly) {
        if (fraction != null) state.weeklyUsage = Math.min(1, fraction);
        if (resetsAt) state.weeklyResetMs = new Date(resetsAt).getTime() - Date.now();
      } else {
        // Session / 5-hour window
        if (fraction != null) state.sessionUsage = Math.min(1, fraction);
        if (resetsAt) state.sessionResetMs = new Date(resetsAt).getTime() - Date.now();
      }
    }

    // Fallback: top-level fraction field
    if (state.sessionUsage === null && evt.fraction != null) {
      state.sessionUsage = Math.min(1, evt.fraction);
    }
  } catch (err) {
    console.warn(`${LOG} parseMessageLimit error:`, err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. TOKEN COUNTING (using claude-counter's vendored tokenizer)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * countConversationTokens
 * ------------------------
 * Uses the vendored gpt-tokenizer (o200k_base BPE — same vocab as Claude)
 * to count tokens accurately. Falls back to length/4 estimate if unavailable.
 * Approach adapted from claude-counter by she-llac.
 *
 * @param {object} requestBody    - original Claude POST body
 * @param {string} assistantReply - the streamed assistant response
 */
function countConversationTokens(requestBody, assistantReply) {
  try {
    // GPTTokenizer_o200k_base is the global exported by vendor/gpt-tokenizer.js
    if (typeof GPTTokenizer_o200k_base === 'undefined') {
      throw new Error('tokenizer not loaded');
    }

    const messages = requestBody?.messages ?? [];
    let total = 0;

    for (const msg of messages) {
      const text = typeof msg.content === 'string'
        ? msg.content
        : (msg.content ?? []).map(c => c.text ?? '').join(' ');
      total += GPTTokenizer_o200k_base.encode(text).length;
    }

    if (assistantReply) {
      total += GPTTokenizer_o200k_base.encode(assistantReply).length;
    }

    state.tokenCount = total;
  } catch {
    // Rough fallback: 1 token ≈ 4 chars
    const allText = JSON.stringify(requestBody ?? '') + (assistantReply ?? '');
    state.tokenCount = Math.ceil(allText.length / 4);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. IN-PAGE HUD (from claude-counter approach)
// ─────────────────────────────────────────────────────────────────────────────

let hudEl = null;

/**
 * injectHUD
 * ---------
 * Creates the ContextPilot HUD bar and appends it to document.body.
 * Idempotent — does nothing if the HUD already exists.
 * Approach adapted from claude-counter by she-llac.
 */
function injectHUD() {
  if (document.getElementById('cp-hud')) return;

  const style = document.createElement('style');
  style.textContent = `
    #cp-hud {
      position:fixed; bottom:0; left:0; right:0; z-index:9999;
      display:flex; align-items:center; flex-wrap:wrap; gap:0;
      padding:4px 14px;
      background:rgba(255,255,255,0.93);
      backdrop-filter:blur(10px);
      border-top:0.5px solid rgba(0,0,0,0.1);
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      font-size:11px; color:#666; user-select:none; line-height:1;
    }
    @media(prefers-color-scheme:dark){
      #cp-hud{background:rgba(26,26,24,0.93);border-color:rgba(255,255,255,0.1);color:#999;}
    }
    .cp-cell{display:flex;align-items:center;gap:4px;padding:3px 10px;border-right:0.5px solid rgba(0,0,0,0.1);}
    .cp-cell:last-child{border-right:none;}
    @media(prefers-color-scheme:dark){.cp-cell{border-color:rgba(255,255,255,0.1);}}
    .cp-lbl{font-size:9px;text-transform:uppercase;letter-spacing:.5px;opacity:.55;}
    .cp-val{font-weight:500;}
    .cp-bw{width:44px;height:3px;background:rgba(128,128,128,.15);border-radius:2px;overflow:hidden;}
    .cp-bf{height:100%;width:0%;border-radius:2px;transition:width .4s ease;}
    #cp-v-tok{color:#1D9E75;} .cp-bf-tok{background:#1D9E75;}
    #cp-v-ses{color:#378ADD;} .cp-bf-ses{background:#378ADD;}
    #cp-v-wk {color:#BA7517;} .cp-bf-wk {background:#BA7517;}
    #cp-v-sav{color:#534AB7;}
    #cp-v-cch{color:#888;}
  `;
  document.head.appendChild(style);

  hudEl = document.createElement('div');
  hudEl.id = 'cp-hud';
  hudEl.innerHTML = `
    <div class="cp-cell">
      <span class="cp-lbl">Tokens</span>
      <span class="cp-val" id="cp-v-tok">—</span>
      <div class="cp-bw"><div class="cp-bf cp-bf-tok" id="cp-b-tok"></div></div>
    </div>
    <div class="cp-cell">
      <span class="cp-lbl">Session</span>
      <span class="cp-val" id="cp-v-ses">—</span>
      <div class="cp-bw"><div class="cp-bf cp-bf-ses" id="cp-b-ses"></div></div>
    </div>
    <div class="cp-cell">
      <span class="cp-lbl">Weekly</span>
      <span class="cp-val" id="cp-v-wk">—</span>
      <div class="cp-bw"><div class="cp-bf cp-bf-wk" id="cp-b-wk"></div></div>
    </div>
    <div class="cp-cell">
      <span class="cp-lbl">Saved</span>
      <span class="cp-val" id="cp-v-sav">—</span>
    </div>
    <div class="cp-cell">
      <span class="cp-lbl">Cache</span>
      <span class="cp-val" id="cp-v-cch">—</span>
    </div>
  `;
  document.body.appendChild(hudEl);

  // Tick every second to update countdowns
  setInterval(updateHUD, 1000);
  console.log(`${LOG} HUD injected`);
}

/**
 * updateHUD
 * ---------
 * Refreshes all displayed values in the HUD bar.
 */
function updateHUD() {
  if (!document.getElementById('cp-hud')) { injectHUD(); return; }

  const tokPct = Math.min(100, Math.round((state.tokenCount / CONTEXT_LIMIT_TOKENS) * 100));
  setHUD('cp-v-tok', formatK(state.tokenCount));
  setBar('cp-b-tok', tokPct);

  if (state.sessionUsage !== null) {
    const p = Math.round(state.sessionUsage * 100);
    setHUD('cp-v-ses', `${p}%`);
    setBar('cp-b-ses', p);
  }

  if (state.weeklyUsage !== null) {
    const p = Math.round(state.weeklyUsage * 100);
    setHUD('cp-v-wk', `${p}%`);
    setBar('cp-b-wk', p);
  }

  setHUD('cp-v-sav', state.tokensSaved > 0 ? `↓${formatK(state.tokensSaved)}` : '—');

  if (state.cacheExpiresAt) {
    const rem = state.cacheExpiresAt - Date.now();
    setHUD('cp-v-cch', rem > 0 ? formatMs(rem) : 'expired');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. DOM OBSERVER — SPA NAVIGATION (from claude-counter)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * watchNavigation
 * ---------------
 * claude.ai is a React SPA. Route changes can unmount the HUD.
 * MutationObserver watches body children and re-injects if the HUD disappears.
 * Adapted from claude-counter by she-llac.
 */
function watchNavigation() {
  new MutationObserver(() => {
    if (!document.getElementById('cp-hud')) {
      hudEl = null;
      injectHUD();
    }
  }).observe(document.body, { childList: true, subtree: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. COMPRESSION STATS SYNC (ContextPilot)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * refreshCompressionStats
 * ------------------------
 * Pulls current compression stats from background.js and updates state.
 * Called after each successful compression and on page load.
 */
async function refreshCompressionStats() {
  try {
    const stats = await sendMessage({ type: 'GET_STATS' });
    if (stats && !stats.error) {
      state.tokensSaved = stats.tokensSaved ?? 0;
      state.nodesStored = stats.totalNodes  ?? 0;
    }
  } catch { /* non-fatal */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function extractUserMessage(body) {
  try {
    const msgs = body?.messages ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'human') {
        const c = msgs[i].content;
        if (typeof c === 'string') return c;
        if (Array.isArray(c)) return c.find(x => x.type === 'text')?.text ?? '';
      }
    }
  } catch { /* ignore */ }
  return '';
}

function extractConversationId(url) {
  const m = url.match(/chat_conversations\/([^/]+)/);
  return m ? `conv_${m[1]}` : `conv_unknown_${Date.now()}`;
}

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(msg, res => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(res);
      });
    } catch (e) { reject(e); }
  });
}

function setHUD(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setBar(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = `${Math.min(100, pct)}%`;
}

function formatK(n) {
  if (!n) return '0';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

function formatMs(ms) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────────────────────

injectHUD();
watchNavigation();
refreshCompressionStats();

console.log(`${LOG} v0.5.0 loaded — display (claude-counter) + compression (ContextPilot) active`);
