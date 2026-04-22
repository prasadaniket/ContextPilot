/**
 * ContextPilot v1.0 — background.js
 * --------------------------------
 * Chrome Extension Service Worker. API calls + message routing.
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
import { saveNode, getNodesByConversation, getAllStats, clearConversation, clearAll } from './core/tree_store.js';
import { findTopNodes } from './core/keyword_extractor.js';
import { buildLeanPayload } from './core/context_builder.js';
import { compressExchange } from './core/compressor.js';

const LOG = '[ContextPilot BG]';

// ─── Message Router ───────────────────────────────────────────────────────────

/**
 * chrome.runtime.onMessage listener
 * -----------------------------------
 * Central router for all messages from content_script.js and popup.js.
 * Returns true to signal async response.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => {
      console.error(`${LOG} Message handler error [${message.type}]:`, err);
      sendResponse({ error: err.message });
    });

  return true; // Keep the message channel open for async response
});

/**
 * handleMessage
 * -------------
 * Async dispatcher — routes each message type to its handler function.
 *
 * @param {object} message - { type, payload }
 * @param {object} sender - chrome sender info
 * @returns {Promise<any>} handler result
 */
async function handleMessage(message, sender) {
  switch (message.type) {

    case 'GET_LEAN_CONTEXT':
      return await handleGetLeanContext(message.payload);

    case 'COMPRESS_EXCHANGE':
      return await handleCompressExchange(message.payload);

    case 'GET_STATS':
      return await handleGetStats();

    case 'SAVE_API_KEY':
      return await handleSaveApiKey(message.payload);

    case 'GET_API_KEY_STATUS':
      return await handleGetApiKeyStatus();

    case 'CLEAR_CONVERSATION':
      return await handleClearConversation(message.payload);

    case 'CLEAR_ALL':
      return await handleClearAll();

    default:
      console.warn(`${LOG} Unknown message type:`, message.type);
      return { error: 'Unknown message type' };
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * handleGetLeanContext
 * --------------------
 * Core interception handler. Takes the original Claude request body,
 * finds relevant past nodes from the tree, and returns a modified
 * payload with compressed context instead of full history.
 *
 * @param {object} payload - { originalBody, userMessage, conversationId }
 * @returns {object|null} modified request body, or null if tree is empty
 */
async function handleGetLeanContext({ originalBody, userMessage, conversationId }) {
  try {
    // Get all stored nodes for this conversation
    const nodes = await getNodesByConversation(conversationId);

    // If no history yet, let the request through unchanged
    if (!nodes || nodes.length === 0) {
      console.log(`${LOG} No tree nodes yet — passing original payload`);
      return null;
    }

    // Score and pick the most relevant past nodes
    const topNodes = findTopNodes(nodes, userMessage, 2);

    // Build the lean payload replacing full history with compressed context
    const leanPayload = buildLeanPayload(originalBody, topNodes, userMessage);

    const savedTokens = estimateTokens(JSON.stringify(originalBody)) -
                        estimateTokens(JSON.stringify(leanPayload));

    console.log(`${LOG} Lean payload built — saved ~${savedTokens} tokens`);
    return leanPayload;

  } catch (err) {
    console.error(`${LOG} handleGetLeanContext failed:`, err);
    return null; // Fallback: original payload goes through
  }
}

/**
 * handleCompressExchange
 * ----------------------
 * Called after each Claude response completes. Compresses the
 * user+assistant exchange into a compact node and saves it to IndexedDB.
 *
 * @param {object} payload - { userMessage, assistantMessage, conversationId }
 * @returns {object} { success, nodeId }
 */
async function handleCompressExchange({ userMessage, assistantMessage, conversationId }) {
  try {
    const rawText = `User: ${userMessage}\n\nAssistant: ${assistantMessage}`;
    const rawTokenEstimate = estimateTokens(rawText);

    // Get API key from secure storage
    const { cp_api_key } = await chrome.storage.local.get('cp_api_key');

    let compressed = '';
    let compressedTokenEstimate = 0;

    if (cp_api_key) {
      // Compress using Anthropic API — best quality
      compressed = await compressExchange(rawText, cp_api_key);
      compressedTokenEstimate = estimateTokens(compressed);
    } else {
      // Fallback: naive truncation (no API key set yet)
      compressed = naiveSummarize(rawText);
      compressedTokenEstimate = estimateTokens(compressed);
      console.warn(`${LOG} No API key — using naive compression fallback`);
    }

    // Get existing nodes to determine parent and turn index
    const existingNodes = await getNodesByConversation(conversationId);
    const parentId = existingNodes.length > 0
      ? existingNodes[existingNodes.length - 1].id
      : null;

    // Build and save the new tree node
    const node = {
      id: `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      conversationId,
      parentId,
      compressed,
      keywords: extractSimpleKeywords(rawText),
      rawTokenEstimate,
      compressedTokenEstimate,
      timestamp: Date.now(),
      turnIndex: existingNodes.length
    };

    await saveNode(node);

    console.log(`${LOG} Compression complete — node saved (${rawTokenEstimate} → ${compressedTokenEstimate} tokens)`);
    return { success: true, nodeId: node.id };

  } catch (err) {
    console.error(`${LOG} handleCompressExchange failed:`, err);
    return { success: false, error: err.message };
  }
}

/**
 * handleGetStats
 * --------------
 * Returns aggregate stats for the popup dashboard.
 *
 * @returns {object} stats from IndexedDB
 */
async function handleGetStats() {
  try {
    const stats = await getAllStats();
    return stats;
  } catch (err) {
    console.error(`${LOG} handleGetStats failed:`, err);
    return { error: err.message };
  }
}

/**
 * handleSaveApiKey
 * ----------------
 * Stores the Anthropic API key in chrome.storage.local (encrypted by Chrome).
 * Never stored in plain JS or committed to GitHub.
 *
 * @param {object} payload - { apiKey }
 * @returns {object} { success }
 */
async function handleSaveApiKey({ apiKey }) {
  try {
    if (!apiKey || !apiKey.startsWith('sk-ant-')) {
      return { success: false, error: 'Invalid API key format (must start with sk-ant-)' };
    }
    await chrome.storage.local.set({ cp_api_key: apiKey });
    console.log(`${LOG} API key saved`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * handleGetApiKeyStatus
 * ----------------------
 * Returns whether an API key is set (masked for display — never the full key).
 *
 * @returns {object} { isSet, maskedKey }
 */
async function handleGetApiKeyStatus() {
  try {
    const { cp_api_key } = await chrome.storage.local.get('cp_api_key');
    if (!cp_api_key) return { isSet: false, maskedKey: null };
    // Show only last 4 chars: sk-ant-...XXXX
    const masked = `sk-ant-...${cp_api_key.slice(-4)}`;
    return { isSet: true, maskedKey: masked };
  } catch (err) {
    return { isSet: false, maskedKey: null };
  }
}

/**
 * handleClearConversation
 * ------------------------
 * Deletes all nodes for a specific conversation from IndexedDB.
 *
 * @param {object} payload - { conversationId }
 * @returns {object} { success }
 */
async function handleClearConversation({ conversationId }) {
  try {
    await clearConversation(conversationId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * handleClearAll
 * --------------
 * Wipes the entire IndexedDB — full reset.
 *
 * @returns {object} { success }
 */
async function handleClearAll() {
  try {
    await clearAll();
    console.log(`${LOG} All data cleared`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Utility Functions ────────────────────────────────────────────────────────

/**
 * estimateTokens
 * --------------
 * Fast token count approximation. 1 token ≈ 4 characters (OpenAI/Anthropic average).
 *
 * @param {string} text
 * @returns {number} estimated token count
 */
function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

/**
 * naiveSummarize
 * --------------
 * Fallback compression when no API key is set.
 * Simply truncates to first 400 characters and adds an ellipsis.
 * Not smart, but safe — never crashes.
 *
 * @param {string} text
 * @returns {string} truncated summary
 */
function naiveSummarize(text) {
  if (text.length <= 400) return text;
  return text.slice(0, 400) + '... [truncated]';
}

/**
 * extractSimpleKeywords
 * ----------------------
 * Quick keyword extraction for background.js (avoids importing keyword_extractor
 * before it's needed). Splits on whitespace, filters stop words, returns top 8.
 *
 * @param {string} text
 * @returns {string[]} array of keyword strings
 */
function extractSimpleKeywords(text) {
  const stopWords = new Set(['the', 'a', 'an', 'is', 'it', 'in', 'on', 'at', 'to',
    'for', 'of', 'and', 'or', 'but', 'i', 'you', 'we', 'this', 'that', 'with',
    'can', 'how', 'what', 'my', 'your', 'do', 'did', 'was', 'are', 'be', 'have',
    'has', 'had', 'not', 'so', 'if', 'as', 'by', 'from', 'will', 'would']);

  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));

  // Count frequency
  const freq = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;

  // Return top 8 by frequency
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);
}

console.log(`${LOG} Service worker started`);
