/**
 * ContextPilot — content_script.js
 * --------------------------
 * Intercepts Claude fetch streams once and feeds both compression and live usage metrics.
 * Part of the ContextPilot Chrome Extension.
 * GitHub: https://github.com/YOUR_USERNAME/context-pilot
 */

const CLAUDE_COMPLETION_ENDPOINT = /\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/completion/;
const originalFetch = window.fetch.bind(window);
const liveState = {
  tokenCount: 0,
  cacheUntil: null,
  sessionUsagePct: null,
  sessionResetAt: null,
  weeklyUsagePct: null,
  weeklyResetAt: null
};

/**
 * sendRuntimeMessage
 * -----------
 * Sends one message to background service worker and returns its response.
 *
 * @param {Object} message - Runtime message payload.
 * @returns {Promise<Object>} Background response.
 */
async function sendRuntimeMessage(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    console.error('[ContextPilot] Runtime message failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * publishLiveMetrics
 * -----------
 * Pushes latest live token and usage metrics to background memory.
 *
 * @returns {Promise<void>} Resolves after publish attempt.
 */
async function publishLiveMetrics() {
  try {
    await sendRuntimeMessage({ type: 'UPDATE_LIVE_METRICS', payload: { ...liveState } });
  } catch (error) {
    console.error('[ContextPilot] Failed to publish live metrics:', error);
  }
}

/**
 * extractConversationId
 * -----------
 * Extracts Claude conversation id from completion request URL.
 *
 * @param {string} url - Request URL.
 * @returns {string} Normalized conversation id.
 */
function extractConversationId(url) {
  const match = url.match(/chat_conversations\/([^/]+)/);
  return match ? `conv_${match[1]}` : `conv_unknown_${Date.now()}`;
}

/**
 * extractTextFromContent
 * -----------
 * Extracts text from Claude message content string/array formats.
 *
 * @param {string|Object[]} content - Message content payload.
 * @returns {string} Extracted text.
 */
function extractTextFromContent(content) {
  try {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .filter((part) => part?.type === 'text')
        .map((part) => part.text || '')
        .join('\n');
    }
    return '';
  } catch (error) {
    console.error('[ContextPilot] extractTextFromContent failed:', error);
    return '';
  }
}

/**
 * extractLatestUserMessage
 * -----------
 * Gets the latest user message text from Claude request payload.
 *
 * @param {Object} body - Parsed Claude completion request body.
 * @returns {string} Latest user prompt text.
 */
function extractLatestUserMessage(body) {
  try {
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role === 'user' || message?.role === 'human') {
        return extractTextFromContent(message.content);
      }
    }
    return '';
  } catch (error) {
    console.error('[ContextPilot] extractLatestUserMessage failed:', error);
    return '';
  }
}

/**
 * estimateTokens
 * -----------
 * Counts tokens using vendored tokenizer when available, otherwise char heuristic.
 *
 * @param {string} text - Input text to count.
 * @returns {number} Estimated token count.
 */
function estimateTokens(text) {
  try {
    const tokenizer = globalThis.ContextPilotTokenizer || globalThis.GPTTokenizer_o200k_base;
    if (tokenizer?.countTokens && typeof tokenizer.countTokens === 'function') {
      return tokenizer.countTokens(text || '');
    }
    return Math.ceil((text || '').length / 4);
  } catch (_error) {
    return Math.ceil((text || '').length / 4);
  }
}

/**
 * extractAllMessageText
 * -----------
 * Flattens a Claude request messages array into one text blob for counting.
 *
 * @param {Object[]} messages - Claude request messages list.
 * @returns {string} Joined message text.
 */
function extractAllMessageText(messages) {
  try {
    return (Array.isArray(messages) ? messages : [])
      .map((message) => extractTextFromContent(message?.content))
      .join('\n');
  } catch (error) {
    console.error('[ContextPilot] extractAllMessageText failed:', error);
    return '';
  }
}

/**
 * toEpochMs
 * -----------
 * Converts reset timestamp values to epoch milliseconds.
 *
 * @param {number|string|null} value - Timestamp candidate.
 * @returns {number|null} Epoch milliseconds or null.
 */
function toEpochMs(value) {
  try {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value > 1_000_000_000_000 ? value : value * 1000;
    }
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  } catch (_error) {
    return null;
  }
}

/**
 * parseSseChunk
 * -----------
 * Parses one SSE chunk and extracts text deltas, done marker, and usage windows.
 *
 * @param {string} chunkText - Raw SSE chunk text.
 * @returns {{ done: boolean, textDelta: string }} Parsed chunk result.
 */
function parseSseChunk(chunkText) {
  let done = false;
  let textDelta = '';
  const lines = chunkText.split('\n');

  for (const line of lines) {
    if (!line.startsWith('data:')) {
      continue;
    }
    const data = line.slice(5).trim();
    if (data === '[DONE]') {
      done = true;
      continue;
    }
    if (!data) {
      continue;
    }

    try {
      const parsed = JSON.parse(data);
      if (parsed?.delta?.text) {
        textDelta += parsed.delta.text;
      } else if (parsed?.content_block?.text) {
        textDelta += parsed.content_block.text;
      }

      if (parsed?.type === 'message_limit' && parsed?.message_limit?.windows) {
        const windows = parsed.message_limit.windows;
        if (typeof windows['5h']?.utilization === 'number') {
          liveState.sessionUsagePct = Math.round(windows['5h'].utilization * 10000) / 100;
          liveState.sessionResetAt = toEpochMs(windows['5h'].resets_at);
        }
        if (typeof windows['7d']?.utilization === 'number') {
          liveState.weeklyUsagePct = Math.round(windows['7d'].utilization * 10000) / 100;
          liveState.weeklyResetAt = toEpochMs(windows['7d'].resets_at);
        }
      }
    } catch (_error) {
      // Ignore non-JSON SSE lines.
    }
  }
  return { done, textDelta };
}

/**
 * watchCompletionStream
 * -----------
 * Reads cloned Claude SSE response stream and updates both compression and live metrics.
 *
 * @param {Response} response - Cloned fetch response.
 * @param {Object} meta - Meta fields for compression payload.
 * @returns {Promise<void>} Resolves after stream processing.
 */
async function watchCompletionStream(response, meta) {
  try {
    const reader = response.body?.getReader();
    if (!reader) {
      return;
    }

    const decoder = new TextDecoder();
    let assistantMsg = '';
    let streamDone = false;

    while (!streamDone) {
      const { value, done } = await reader.read();
      streamDone = done;
      if (!value) {
        continue;
      }
      const chunk = decoder.decode(value, { stream: !done });
      const parsed = parseSseChunk(chunk);
      assistantMsg += parsed.textDelta;
      if (parsed.done) {
        streamDone = true;
      }
    }

    liveState.cacheUntil = Date.now() + (5 * 60 * 1000);
    await publishLiveMetrics();

    if (assistantMsg.trim()) {
      await sendRuntimeMessage({
        type: 'COMPRESS_EXCHANGE',
        payload: {
          userMsg: meta.userMsg,
          assistantMsg,
          conversationId: meta.conversationId
        }
      });
    }
  } catch (error) {
    console.error('[ContextPilot] Stream watcher failed:', error);
  }
}

window.fetch = async function interceptedFetch(resource, init = {}) {
  try {
    const url = typeof resource === 'string' ? resource : resource?.url || '';
    const method = (init?.method || 'GET').toUpperCase();

    if (!CLAUDE_COMPLETION_ENDPOINT.test(url) || method !== 'POST') {
      return originalFetch(resource, init);
    }

    console.log('[ContextPilot] Intercepted request');

    const nextInit = { ...init };
    let parsedBody = null;
    let userMsg = '';
    const conversationId = extractConversationId(url);

    try {
      parsedBody = nextInit.body ? JSON.parse(nextInit.body) : {};
      userMsg = extractLatestUserMessage(parsedBody);
      liveState.tokenCount = estimateTokens(extractAllMessageText(parsedBody?.messages));
      await publishLiveMetrics();

      const response = await sendRuntimeMessage({
        type: 'GET_LEAN_CONTEXT',
        payload: {
          originalBody: parsedBody,
          userMsg,
          conversationId
        }
      });
      if (response?.success && response.leanPayload) {
        nextInit.body = JSON.stringify(response.leanPayload);
      }
    } catch (error) {
      console.error('[ContextPilot] Interception fallback to original payload:', error);
    }

    const response = await originalFetch(resource, nextInit);
    watchCompletionStream(response.clone(), { userMsg, conversationId });
    return response;
  } catch (error) {
    console.error('[ContextPilot] Fetch interceptor failed; using original fetch:', error);
    return originalFetch(resource, init);
  }
};
