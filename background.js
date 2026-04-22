/**
 * ContextPilot — background.js
 * --------------------------
 * Service worker for context building, compression, storage, and popup stats.
 * Part of the ContextPilot Chrome Extension.
 * GitHub: https://github.com/YOUR_USERNAME/context-pilot
 */

import { saveNode, getNodesByConversation, getAllStats, getConversationCount, clearConversation, clearAll } from './core/tree_store.js';
import { extractKeywords, findTopNodes } from './core/keyword_extractor.js';
import { buildLeanPayload } from './core/context_builder.js';
import { compressExchange } from './core/compressor.js';

const liveMetrics = {
  tokenCount: 0,
  cacheUntil: null,
  sessionUsagePct: null,
  sessionResetAt: null,
  weeklyUsagePct: null,
  weeklyResetAt: null,
  updatedAt: null
};

/**
 * estimateTokens
 * -----------
 * Estimates token count using lightweight character heuristic.
 *
 * @param {string} text - Text to estimate.
 * @returns {number} Token estimate.
 */
function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

/**
 * maskApiKey
 * -----------
 * Produces a safe masked API key for popup display.
 *
 * @param {string} apiKey - Unmasked API key.
 * @returns {string} Masked API key string.
 */
function maskApiKey(apiKey) {
  if (!apiKey) {
    return '';
  }
  return `${apiKey.slice(0, 10)}...${apiKey.slice(-4)}`;
}

/**
 * handleGetLeanContext
 * -----------
 * Builds and returns lean request payload for a conversation and prompt.
 *
 * @param {Object} payload - Request context payload.
 * @returns {Promise<Object>} Lean payload object.
 */
async function handleGetLeanContext(payload) {
  try {
    const { originalBody, userMsg, conversationId } = payload;
    const nodes = await getNodesByConversation(conversationId);
    const topNodes = findTopNodes(nodes, userMsg, 2);
    return {
      success: true,
      leanPayload: buildLeanPayload(originalBody, topNodes, userMsg)
    };
  } catch (error) {
    console.error('[ContextPilot] GET_LEAN_CONTEXT failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * handleCompressExchange
 * -----------
 * Compresses one exchange, stores a node, and returns save metadata.
 *
 * @param {Object} payload - Compression payload from content script.
 * @returns {Promise<Object>} Compression status and created node id.
 */
async function handleCompressExchange(payload) {
  try {
    const { userMsg, assistantMsg, conversationId } = payload;
    const exchangeText = `User: ${userMsg}\nAssistant: ${assistantMsg}`;
    const rawTokenEstimate = estimateTokens(exchangeText);
    const { cp_api_key } = await chrome.storage.local.get('cp_api_key');
    const existingNodes = await getNodesByConversation(conversationId);

    let compressed = exchangeText;
    try {
      if (cp_api_key) {
        compressed = await compressExchange(exchangeText, cp_api_key);
      }
    } catch (error) {
      console.error('[ContextPilot] Compression API failed, using raw fallback:', error);
      compressed = exchangeText;
    }

    const node = {
      id: `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      conversationId,
      parentId: existingNodes.length ? existingNodes[existingNodes.length - 1].id : null,
      compressed,
      keywords: extractKeywords(exchangeText, 8),
      rawTokenEstimate,
      compressedTokenEstimate: estimateTokens(compressed),
      timestamp: Date.now(),
      turnIndex: existingNodes.length
    };

    await saveNode(node);
    console.log('[ContextPilot] Compression complete — node saved');
    return { success: true, nodeId: node.id };
  } catch (error) {
    console.error('[ContextPilot] COMPRESS_EXCHANGE failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * handleGetStats
 * -----------
 * Loads aggregate token and tree stats for popup dashboard.
 *
 * @returns {Promise<Object>} Dashboard stats payload.
 */
async function handleGetStats() {
  try {
    const stats = await getAllStats();
    const conversations = await getConversationCount();
    const compressionRatio = stats.totalRawTokens > 0
      ? Math.round((stats.tokensSaved / stats.totalRawTokens) * 100)
      : 0;

    return { ...stats, conversations, compressionRatio };
  } catch (error) {
    console.error('[ContextPilot] GET_STATS failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * handleUpdateLiveMetrics
 * -----------
 * Updates in-memory live usage and token metrics from claude.ai stream events.
 *
 * @param {Object} payload - Live metrics payload from content script.
 * @returns {Promise<Object>} Update status response.
 */
async function handleUpdateLiveMetrics(payload) {
  try {
    Object.assign(liveMetrics, {
      tokenCount: Number.isFinite(payload?.tokenCount) ? payload.tokenCount : liveMetrics.tokenCount,
      cacheUntil: Number.isFinite(payload?.cacheUntil) ? payload.cacheUntil : liveMetrics.cacheUntil,
      sessionUsagePct: Number.isFinite(payload?.sessionUsagePct) ? payload.sessionUsagePct : liveMetrics.sessionUsagePct,
      sessionResetAt: Number.isFinite(payload?.sessionResetAt) ? payload.sessionResetAt : liveMetrics.sessionResetAt,
      weeklyUsagePct: Number.isFinite(payload?.weeklyUsagePct) ? payload.weeklyUsagePct : liveMetrics.weeklyUsagePct,
      weeklyResetAt: Number.isFinite(payload?.weeklyResetAt) ? payload.weeklyResetAt : liveMetrics.weeklyResetAt,
      updatedAt: Date.now()
    });
    return { success: true };
  } catch (error) {
    console.error('[ContextPilot] UPDATE_LIVE_METRICS failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * handleGetLiveUsage
 * -----------
 * Returns latest in-memory live usage and cache metrics for popup rendering.
 *
 * @returns {Promise<Object>} Live metrics payload.
 */
async function handleGetLiveUsage() {
  try {
    return { success: true, ...liveMetrics };
  } catch (error) {
    console.error('[ContextPilot] GET_LIVE_USAGE failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * handleSaveApiKey
 * -----------
 * Saves user-provided Anthropic API key to extension local storage.
 *
 * @param {Object} payload - Save payload containing apiKey.
 * @returns {Promise<Object>} Save status.
 */
async function handleSaveApiKey(payload) {
  try {
    await chrome.storage.local.set({ cp_api_key: payload.apiKey || '' });
    return { success: true };
  } catch (error) {
    console.error('[ContextPilot] SAVE_API_KEY failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * handleGetApiKey
 * -----------
 * Returns masked API key metadata for popup settings display.
 *
 * @returns {Promise<Object>} Masked key info.
 */
async function handleGetApiKey() {
  try {
    const { cp_api_key } = await chrome.storage.local.get('cp_api_key');
    return {
      success: true,
      hasKey: Boolean(cp_api_key),
      maskedKey: cp_api_key ? maskApiKey(cp_api_key) : ''
    };
  } catch (error) {
    console.error('[ContextPilot] GET_API_KEY failed:', error);
    return { success: false, error: error.message, hasKey: false, maskedKey: '' };
  }
}

/**
 * handleMessage
 * -----------
 * Routes incoming runtime messages to the correct background handler.
 *
 * @param {Object} message - Runtime message object.
 * @returns {Promise<Object>} Handler response payload.
 */
async function handleMessage(message) {
  try {
    switch (message.type) {
      case 'GET_LEAN_CONTEXT':
        return await handleGetLeanContext(message.payload || {});
      case 'COMPRESS_EXCHANGE':
        return await handleCompressExchange(message.payload || {});
      case 'GET_STATS':
        return await handleGetStats();
      case 'UPDATE_LIVE_METRICS':
        return await handleUpdateLiveMetrics(message.payload || {});
      case 'GET_LIVE_USAGE':
        return await handleGetLiveUsage();
      case 'SAVE_API_KEY':
        return await handleSaveApiKey(message.payload || {});
      case 'GET_API_KEY':
        return await handleGetApiKey();
      case 'CLEAR_CONVERSATION':
        await clearConversation(message.payload?.conversationId || '');
        return { success: true };
      case 'CLEAR_ALL':
        await clearAll();
        return { success: true };
      default:
        return { success: false, error: `Unknown message type: ${message.type}` };
    }
  } catch (error) {
    console.error('[ContextPilot] Message handling failed:', error);
    return { success: false, error: error.message };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true;
});
