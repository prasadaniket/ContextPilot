/**
 * ContextPilot v1.0 — tree_store.js
 * --------------------------------
 * IndexedDB CRUD for prompt tree nodes.
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
 * GitHub: https://github.com/YOUR_USERNAME/context-pilot
 */
const DB_NAME = 'ContextPilotDB';
const DB_VERSION = 1;
const STORE_NAME = 'nodes';

// ─── Database Setup ───────────────────────────────────────────────────────────

/**
 * openDB
 * ------
 * Opens (or creates) the IndexedDB database.
 * Creates the 'nodes' object store with indexes on first run.
 *
 * @returns {Promise<IDBDatabase>} opened database instance
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // Runs on first install or version upgrade — creates schema
    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });

        // Index so we can quickly fetch all nodes for a conversation
        store.createIndex('conversationId', 'conversationId', { unique: false });

        // Index for time-based queries
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

// ─── CRUD Operations ──────────────────────────────────────────────────────────

/**
 * saveNode
 * --------
 * Adds or updates a node in the tree store.
 * If a node with the same id exists, it will be replaced.
 *
 * @param {object} node - must match the ContextPilot node schema
 * @returns {Promise<void>}
 */
export async function saveNode(node) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(node);

    request.onsuccess = () => resolve();
    request.onerror = (event) => reject(event.target.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * getNodesByConversation
 * ----------------------
 * Returns all nodes for a given conversationId, sorted oldest-first.
 * Used by context_builder.js to find relevant past context.
 *
 * @param {string} conversationId - the conversation identifier
 * @returns {Promise<object[]>} array of node objects, sorted by timestamp
 */
export async function getNodesByConversation(conversationId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('conversationId');
    const request = index.getAll(conversationId);

    request.onsuccess = (event) => {
      const nodes = event.target.result || [];
      // Sort oldest first so parent links make sense
      nodes.sort((a, b) => a.timestamp - b.timestamp);
      resolve(nodes);
    };
    request.onerror = (event) => reject(event.target.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * getAllStats
 * ----------
 * Aggregates stats across the entire tree for the popup dashboard.
 * Scans all nodes and sums token estimates.
 *
 * @returns {Promise<object>} { totalNodes, totalRawTokens, totalCompressedTokens, tokensSaved, compressionRatio, conversationCount }
 */
export async function getAllStats() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = (event) => {
      const nodes = event.target.result || [];

      const totalRawTokens = nodes.reduce((sum, n) => sum + (n.rawTokenEstimate || 0), 0);
      const totalCompressedTokens = nodes.reduce((sum, n) => sum + (n.compressedTokenEstimate || 0), 0);
      const conversations = new Set(nodes.map(n => n.conversationId));

      const compressionRatio = totalRawTokens > 0
        ? Math.round((1 - totalCompressedTokens / totalRawTokens) * 100)
        : 0;

      resolve({
        totalNodes: nodes.length,
        totalRawTokens,
        totalCompressedTokens,
        tokensSaved: totalRawTokens - totalCompressedTokens,
        compressionRatio,
        conversationCount: conversations.size
      });
    };

    request.onerror = (event) => reject(event.target.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * clearConversation
 * -----------------
 * Deletes all nodes belonging to a single conversation.
 * Called when user manually resets a specific chat's tree.
 *
 * @param {string} conversationId
 * @returns {Promise<void>}
 */
export async function clearConversation(conversationId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('conversationId');
    const request = index.getAll(conversationId);

    request.onsuccess = (event) => {
      const nodes = event.target.result || [];
      for (const node of nodes) {
        store.delete(node.id);
      }
    };

    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = (event) => reject(event.target.error);
  });
}

/**
 * clearAll
 * --------
 * Wipes the entire IndexedDB store — full reset.
 * Called from the popup's "Clear all data" button.
 *
 * @returns {Promise<void>}
 */
export async function clearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = (event) => reject(event.target.error);
    tx.oncomplete = () => db.close();
  });
}
