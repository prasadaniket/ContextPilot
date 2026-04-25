/**
 * ContextPilot v2.0 — background.js
 * Service worker. Single file. No ES module imports. All classes inline.
 */
(function () {
  'use strict';

  // ── CLASS 1: TreeStore ────────────────────────────────────────────────────
  class TreeStore {
    constructor() {
      this.dbName = 'ContextPilotDB';
      this.dbVersion = 1;
      this.storeName = 'nodes';
      this._db = null;
    }

    async openDB() {
      if (this._db) return this._db;
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(this.dbName, this.dbVersion);
        req.onupgradeneeded = e => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
            store.createIndex('conversationId', 'conversationId', { unique: false });
            store.createIndex('timestamp', 'timestamp', { unique: false });
          }
        };
        req.onsuccess = e => { this._db = e.target.result; resolve(this._db); };
        req.onerror = e => reject(e.target.error);
      });
    }

    async saveNode(node) {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).put(node);
        tx.oncomplete = () => resolve(node.id);
        tx.onerror = e => reject(e.target.error);
      });
    }

    async getNodesByConversation(conversationId) {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readonly');
        const idx = tx.objectStore(this.storeName).index('conversationId');
        const req = idx.getAll(conversationId);
        req.onsuccess = e => resolve((e.target.result || []).sort((a, b) => a.timestamp - b.timestamp));
        req.onerror = e => reject(e.target.error);
      });
    }

    async getAllStats() {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readonly');
        const req = tx.objectStore(this.storeName).getAll();
        req.onsuccess = e => {
          const nodes = e.target.result || [];
          const convIds = new Set(nodes.map(n => n.conversationId));
          const rawTotal = nodes.reduce((s, n) => s + (n.rawTokenEstimate || 0), 0);
          const compTotal = nodes.reduce((s, n) => s + (n.compressedTokenEstimate || 0), 0);
          const tokensSaved = rawTotal - compTotal;
          const compressionRatio = rawTotal > 0 ? Math.round((tokensSaved / rawTotal) * 100) : 0;
          resolve({
            totalNodes: nodes.length,
            conversationCount: convIds.size,
            tokensSaved,
            compressionRatio
          });
        };
        req.onerror = e => reject(e.target.error);
      });
    }

    async clearConversation(conversationId) {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        const idx = tx.objectStore(this.storeName).index('conversationId');
        const req = idx.getAllKeys(conversationId);
        req.onsuccess = e => {
          const keys = e.target.result || [];
          keys.forEach(k => tx.objectStore(this.storeName).delete(k));
        };
        tx.oncomplete = () => resolve(true);
        tx.onerror = e => reject(e.target.error);
      });
    }

    async clearAll() {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = e => reject(e.target.error);
      });
    }

    async exportConversation(conversationId) {
      const nodes = conversationId
        ? await this.getNodesByConversation(conversationId)
        : await this._getAll();
      const edges = nodes
        .filter(n => n.parentId)
        .map(n => ({ source: n.parentId, target: n.id }));
      return { nodes, edges };
    }

    async _getAll() {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const req = db.transaction(this.storeName, 'readonly').objectStore(this.storeName).getAll();
        req.onsuccess = e => resolve(e.target.result || []);
        req.onerror = e => reject(e.target.error);
      });
    }
  }

  // ── CLASS 2: KeywordExtractor ─────────────────────────────────────────────
  class KeywordExtractor {
    constructor() {
      this._stop = new Set([
        'the','a','an','is','it','in','on','at','to','for','of','and','or','but',
        'i','you','we','this','that','with','can','how','what','my','your','do',
        'did','was','are','be','have','has','had','not','so','if','as','by','from',
        'will','would','should','could','may','might','just','then','than','when',
        'here','there','their','they','them','these','those','more','some','all',
        'get','got','set','use','let','one','two','its','also','been','into'
      ]);
    }

    extractKeywords(text, n = 8) {
      const words = (text || '').toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !this._stop.has(w));
      const freq = {};
      for (const w of words) freq[w] = (freq[w] || 0) + 1;
      return Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([w]) => w);
    }

    scoreNodeRelevance(node, query) {
      const qWords = new Set(this.extractKeywords(query, 20));
      const nWords = new Set(node.keywords || []);
      let score = 0;
      for (const w of qWords) if (nWords.has(w)) score++;
      return score;
    }

    findTopNodes(nodes, query, k = 2) {
      if (!nodes || nodes.length === 0) return [];
      return [...nodes]
        .map(n => ({ node: n, score: this.scoreNodeRelevance(n, query) }))
        .sort((a, b) => b.score - a.score || b.node.timestamp - a.node.timestamp)
        .slice(0, k)
        .map(x => x.node);
    }
  }

  // ── CLASS 3: ContextBuilder ───────────────────────────────────────────────
  class ContextBuilder {
    buildLeanPayload(originalBody, topNodes, userMsg) {
      if (!topNodes || topNodes.length === 0) return null;
      const contextBlock = topNodes
        .map((n, i) => `[Context ${i + 1}]: ${n.compressed}`)
        .join('\n\n');
      const systemInjection = `<context_summary>\n${contextBlock}\n</context_summary>\n\nCurrent request:`;
      const messages = originalBody.messages || [];
      const humanMsgs = messages.filter(m => m.role === 'human');
      const latestHuman = humanMsgs[humanMsgs.length - 1];
      if (!latestHuman) return null;
      const leanMessages = [
        {
          role: 'human',
          content: systemInjection + '\n\n' + (
            typeof latestHuman.content === 'string'
              ? latestHuman.content
              : (latestHuman.content || []).map(c => c.text || '').join(' ')
          )
        }
      ];
      return { ...originalBody, messages: leanMessages };
    }
  }

  // ── CLASS 4: Compressor ───────────────────────────────────────────────────
  class Compressor {
    async compressExchange(rawText, apiKey) {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 120,
          messages: [{
            role: 'user',
            content: `You are a lossless conversation compressor.\nSummarize this exchange in UNDER 80 tokens.\nPRESERVE: key decisions, facts, code, task context, named entities, numbers.\nDISCARD: greetings, filler, repetition, politeness.\nOutput ONLY the summary. No preamble, no labels, no quotes.\n\n${rawText}`
          }]
        })
      });
      if (!resp.ok) throw new Error(`Anthropic API ${resp.status}`);
      const data = await resp.json();
      return data?.content?.[0]?.text || '';
    }
  }

  // ── CLASS 5: BackgroundController ────────────────────────────────────────
  class BackgroundController {
    constructor() {
      this.store = new TreeStore();
      this.keywords = new KeywordExtractor();
      this.builder = new ContextBuilder();
      this.compressor = new Compressor();
      this._grabTab = null;
    }

    listen() {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        this._handle(msg, sender)
          .then(sendResponse)
          .catch(err => sendResponse({ error: err.message }));
        return true;
      });
    }

    async _handle(msg) {
      switch (msg.type) {
        case 'GET_LEAN_CONTEXT':    return this._getLeanContext(msg.payload);
        case 'COMPRESS_EXCHANGE':   return this._compressExchange(msg.payload);
        case 'GET_STATS':           return this.store.getAllStats();
        case 'GET_GRAPH_DATA':      return this._getGraphData(msg.payload);
        case 'EXPORT_CONVERSATION': return this.store.exportConversation(msg.payload?.conversationId);
        case 'CLEAR_CONVERSATION':  return this._clearConv(msg.payload);
        case 'CLEAR_ALL':           return this._clearAll();
        case 'SAVE_API_KEY':        return this._saveApiKey(msg.payload);
        case 'GET_API_KEY_STATUS':  return this._getApiKeyStatus();
        case 'GRAB_API_KEY':        return this._grabApiKey();
        case 'API_KEY_CAPTURED':    return this._onApiKeyCaptured(msg.key);
        default: return { error: 'Unknown message type: ' + msg.type };
      }
    }

    async _getLeanContext({ originalBody, userMessage, conversationId, depth = 2 }) {
      try {
        const nodes = await this.store.getNodesByConversation(conversationId);
        if (!nodes || nodes.length === 0) return null;
        const top = this.keywords.findTopNodes(nodes, userMessage, depth);
        return this.builder.buildLeanPayload(originalBody, top, userMessage);
      } catch (e) { return null; }
    }

    async _compressExchange({ userMessage, assistantMessage, conversationId }) {
      try {
        const rawText = `User: ${userMessage}\n\nAssistant: ${assistantMessage}`;
        const rawTokenEstimate = Math.ceil(rawText.length / 4);
        const { cp_api_key } = await chrome.storage.local.get('cp_api_key');
        let compressed = '';
        if (cp_api_key) {
          compressed = await this.compressor.compressExchange(rawText, cp_api_key);
        } else {
          compressed = rawText.length > 400 ? rawText.slice(0, 400) + '...[truncated]' : rawText;
        }
        const compressedTokenEstimate = Math.ceil(compressed.length / 4);
        const existing = await this.store.getNodesByConversation(conversationId);
        const parentId = existing.length > 0 ? existing[existing.length - 1].id : null;
        const node = {
          id: 'node_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          conversationId,
          parentId,
          compressed,
          keywords: this.keywords.extractKeywords(rawText),
          rawTokenEstimate,
          compressedTokenEstimate,
          timestamp: Date.now(),
          turnIndex: existing.length
        };
        await this.store.saveNode(node);
        const updatedNodes = await this.store.getNodesByConversation(conversationId);
        const activeNodeIds = updatedNodes.slice(-3).map(n => n.id);
        return { success: true, nodeId: node.id, activeNodeIds };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }

    async _getGraphData({ conversationId }) {
      try {
        const nodes = await this.store.getNodesByConversation(conversationId);
        const edges = nodes
          .filter(n => n.parentId)
          .map(n => ({ source: n.parentId, target: n.id }));
        const last = nodes[nodes.length - 1];
        const tagged = nodes.map(n => ({ ...n, isCurrent: last && n.id === last.id }));
        return { nodes: tagged, edges };
      } catch (e) { return { nodes: [], edges: [] }; }
    }

    async _clearConv({ conversationId }) {
      try { await this.store.clearConversation(conversationId); return { success: true }; }
      catch (e) { return { success: false, error: e.message }; }
    }

    async _clearAll() {
      try { await this.store.clearAll(); return { success: true }; }
      catch (e) { return { success: false, error: e.message }; }
    }

    async _saveApiKey({ apiKey }) {
      if (!apiKey || !apiKey.startsWith('sk-ant-')) {
        return { success: false, error: 'Invalid API key (must start with sk-ant-)' };
      }
      try {
        await chrome.storage.local.set({ cp_api_key: apiKey });
        return { success: true };
      } catch (e) { return { success: false, error: e.message }; }
    }

    async _getApiKeyStatus() {
      try {
        const { cp_api_key } = await chrome.storage.local.get('cp_api_key');
        if (!cp_api_key) return { isSet: false, maskedKey: null };
        return { isSet: true, maskedKey: 'sk-ant-...' + cp_api_key.slice(-4) };
      } catch { return { isSet: false, maskedKey: null }; }
    }

    async _grabApiKey() {
      try {
        const tab = await chrome.tabs.create({
          url: 'https://console.anthropic.com/settings/keys',
          active: true
        });
        this._grabTab = tab.id;
        return { success: true, message: 'Opening Anthropic console…' };
      } catch (e) { return { success: false, error: e.message }; }
    }

    async _onApiKeyCaptured(key) {
      if (!key) return { success: false };
      try {
        await chrome.storage.local.set({ cp_api_key: key });
        if (this._grabTab) {
          chrome.tabs.remove(this._grabTab).catch(() => {});
          this._grabTab = null;
        }
        return { success: true };
      } catch (e) { return { success: false, error: e.message }; }
    }
  }

  // ── BOOT ───────────────────────────────────────────────────────────────────
  const controller = new BackgroundController();
  controller.listen();

  console.log('[ContextPilot v2.0] service worker started');
})();
