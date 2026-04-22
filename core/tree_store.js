/**
 * ContextPilot — tree_store.js
 * --------------------------
 * IndexedDB CRUD for compressed context tree nodes.
 * Part of the ContextPilot Chrome Extension.
 * GitHub: https://github.com/YOUR_USERNAME/context-pilot
 */

import { openDB } from 'https://cdn.jsdelivr.net/npm/idb@8/+esm';

const DB_NAME = 'ContextPilotDB';
const DB_VERSION = 1;
const STORE_NAME = 'nodes';

/**
 * getDB
 * -----------
 * Opens and initializes the ContextPilot IndexedDB database.
 *
 * @returns {Promise<import('https://cdn.jsdelivr.net/npm/idb@8/+esm').IDBPDatabase>} Database instance.
 */
async function getDB() {
  try {
    return await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('conversationId', 'conversationId', { unique: false });
        }
      }
    });
  } catch (error) {
    console.error('[ContextPilot] Failed to open IndexedDB:', error);
    throw error;
  }
}

/**
 * saveNode
 * -----------
 * Saves one compressed node into IndexedDB.
 *
 * @param {Object} node - Node object matching ContextPilot schema.
 * @returns {Promise<void>} Resolves when the node is persisted.
 */
export async function saveNode(node) {
  try {
    const db = await getDB();
    await db.put(STORE_NAME, node);
  } catch (error) {
    console.error('[ContextPilot] saveNode failed:', error);
    throw error;
  }
}

/**
 * getNodesByConversation
 * -----------
 * Reads all nodes for one conversation and sorts by timestamp.
 *
 * @param {string} conversationId - Conversation identifier.
 * @returns {Promise<Object[]>} Conversation nodes ordered oldest to newest.
 */
export async function getNodesByConversation(conversationId) {
  try {
    const db = await getDB();
    const nodes = await db.getAllFromIndex(STORE_NAME, 'conversationId', conversationId);
    return nodes.sort((a, b) => a.timestamp - b.timestamp);
  } catch (error) {
    console.error('[ContextPilot] getNodesByConversation failed:', error);
    throw error;
  }
}

/**
 * getAllStats
 * -----------
 * Computes aggregate tree and token stats across all conversations.
 *
 * @returns {Promise<Object>} Aggregate stats object for popup dashboard.
 */
export async function getAllStats() {
  try {
    const db = await getDB();
    const nodes = await db.getAll(STORE_NAME);
    const totalRawTokens = nodes.reduce((sum, node) => sum + (node.rawTokenEstimate || 0), 0);
    const totalCompressedTokens = nodes.reduce((sum, node) => sum + (node.compressedTokenEstimate || 0), 0);

    return {
      totalNodes: nodes.length,
      totalRawTokens,
      totalCompressedTokens,
      tokensSaved: totalRawTokens - totalCompressedTokens
    };
  } catch (error) {
    console.error('[ContextPilot] getAllStats failed:', error);
    throw error;
  }
}

/**
 * getConversationCount
 * -----------
 * Counts distinct conversation IDs across all stored nodes.
 *
 * @returns {Promise<number>} Number of distinct conversations.
 */
export async function getConversationCount() {
  try {
    const db = await getDB();
    const nodes = await db.getAll(STORE_NAME);
    return new Set(nodes.map((node) => node.conversationId)).size;
  } catch (error) {
    console.error('[ContextPilot] getConversationCount failed:', error);
    throw error;
  }
}

/**
 * clearConversation
 * -----------
 * Deletes every node for one conversation ID.
 *
 * @param {string} conversationId - Conversation identifier to clear.
 * @returns {Promise<void>} Resolves when conversation nodes are deleted.
 */
export async function clearConversation(conversationId) {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const index = tx.store.index('conversationId');

    for await (const cursor of index.iterate(conversationId)) {
      await cursor.delete();
    }
    await tx.done;
  } catch (error) {
    console.error('[ContextPilot] clearConversation failed:', error);
    throw error;
  }
}

/**
 * clearAll
 * -----------
 * Removes all nodes from IndexedDB for a full reset.
 *
 * @returns {Promise<void>} Resolves when database store is cleared.
 */
export async function clearAll() {
  try {
    const db = await getDB();
    await db.clear(STORE_NAME);
  } catch (error) {
    console.error('[ContextPilot] clearAll failed:', error);
    throw error;
  }
}
