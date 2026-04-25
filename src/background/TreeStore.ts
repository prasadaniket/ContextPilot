import type { ConversationNode, ConversationEdge, Stats } from '../shared/types'

const DB_NAME    = 'ContextPilotDB'
const DB_VERSION = 2
const STORE_NAME = 'nodes'

export class TreeStore {
  private db: IDBDatabase | null = null

  async openDB(): Promise<IDBDatabase> {
    if (this.db) return this.db
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result
        let store: IDBObjectStore
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
          store.createIndex('conversationId', 'conversationId', { unique: false })
          store.createIndex('timestamp',      'timestamp',      { unique: false })
          store.createIndex('blastRadius',    'blastRadius',    { unique: false })
          store.createIndex('community',      'community',      { unique: false })
          store.createIndex('qualityScore',   'qualityScore',   { unique: false })
        } else {
          store = (e.target as IDBOpenDBRequest).transaction!.objectStore(STORE_NAME)
          if (!store.indexNames.contains('blastRadius'))  store.createIndex('blastRadius',  'blastRadius',  { unique: false })
          if (!store.indexNames.contains('community'))    store.createIndex('community',    'community',    { unique: false })
          if (!store.indexNames.contains('qualityScore')) store.createIndex('qualityScore', 'qualityScore', { unique: false })
        }
        // Migrate v1 rows to v3 schema
        if (e.oldVersion < 2) {
          const getAll = store.getAll()
          getAll.onsuccess = (ev) => {
            const rows = (ev.target as IDBRequest<ConversationNode[]>).result
            for (const row of rows) {
              store.put({
                ...row,
                community:     row.community     ?? 0,
                relationTypes: row.relationTypes ?? ['follows'],
                confidence:    row.confidence    ?? 'INFERRED',
                blastRadius:   row.blastRadius   ?? 0,
                semanticHash:  row.semanticHash  ?? '',
                qualityScore:  row.qualityScore  ?? 0,
              })
            }
          }
        }
      }
      req.onsuccess = (e) => {
        this.db = (e.target as IDBOpenDBRequest).result
        resolve(this.db)
      }
      req.onerror = (e) => reject((e.target as IDBOpenDBRequest).error)
    })
  }

  async saveNode(node: ConversationNode): Promise<string> {
    const db = await this.openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(node)
      tx.oncomplete = () => resolve(node.id)
      tx.onerror    = (e) => reject((e.target as IDBRequest).error)
    })
  }

  async updateNode(id: string, patch: Partial<ConversationNode>): Promise<void> {
    const db   = await this.openDB()
    const node = await this.getNodeById(id)
    if (!node) return
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put({ ...node, ...patch })
      tx.oncomplete = () => resolve()
      tx.onerror    = (e) => reject((e.target as IDBRequest).error)
    })
  }

  async getNodeById(id: string): Promise<ConversationNode | undefined> {
    const db = await this.openDB()
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id)
      req.onsuccess = (e) => resolve((e.target as IDBRequest<ConversationNode>).result)
      req.onerror   = (e) => reject((e.target as IDBRequest).error)
    })
  }

  async getNodesByConversation(conversationId: string): Promise<ConversationNode[]> {
    const db = await this.openDB()
    return new Promise((resolve, reject) => {
      const idx = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).index('conversationId')
      const req = idx.getAll(conversationId)
      req.onsuccess = (e) => {
        const rows = (e.target as IDBRequest<ConversationNode[]>).result ?? []
        resolve(rows.sort((a, b) => a.timestamp - b.timestamp))
      }
      req.onerror = (e) => reject((e.target as IDBRequest).error)
    })
  }

  async getNodesByIds(ids: string[], afterTimestamp = 0): Promise<ConversationNode[]> {
    const db = await this.openDB()
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
      req.onsuccess = (e) => {
        const idSet = new Set(ids)
        const rows = (e.target as IDBRequest<ConversationNode[]>).result ?? []
        resolve(rows.filter(n => idSet.has(n.id) && n.timestamp >= afterTimestamp))
      }
      req.onerror = (e) => reject((e.target as IDBRequest).error)
    })
  }

  async getAllNodes(): Promise<ConversationNode[]> {
    const db = await this.openDB()
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
      req.onsuccess = (e) => resolve((e.target as IDBRequest<ConversationNode[]>).result ?? [])
      req.onerror   = (e) => reject((e.target as IDBRequest).error)
    })
  }

  async getAllStats(): Promise<Stats> {
    const nodes   = await this.getAllNodes()
    const convIds = new Set(nodes.map(n => n.conversationId))
    const rawTotal  = nodes.reduce((s, n) => s + (n.rawTokenEstimate  || 0), 0)
    const compTotal = nodes.reduce((s, n) => s + (n.compressedTokenEstimate || 0), 0)
    const tokensSaved      = rawTotal - compTotal
    const compressionRatio = rawTotal > 0 ? Math.round((tokensSaved / rawTotal) * 100) : 0
    const avgQualityScore  = nodes.length > 0
      ? Math.round(nodes.reduce((s, n) => s + (n.qualityScore || 0), 0) / nodes.length)
      : 0
    return { totalNodes: nodes.length, conversationCount: convIds.size, tokensSaved, compressionRatio, avgQualityScore }
  }

  async clearConversation(conversationId: string): Promise<void> {
    const db = await this.openDB()
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE_NAME, 'readwrite')
      const idx = tx.objectStore(STORE_NAME).index('conversationId')
      const req = idx.getAllKeys(conversationId)
      req.onsuccess = (e) => {
        const keys = (e.target as IDBRequest<IDBValidKey[]>).result ?? []
        keys.forEach(k => tx.objectStore(STORE_NAME).delete(k))
      }
      tx.oncomplete = () => resolve()
      tx.onerror    = (e) => reject((e.target as IDBRequest).error)
    })
  }

  async clearAll(): Promise<void> {
    const db = await this.openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).clear()
      tx.oncomplete = () => resolve()
      tx.onerror    = (e) => reject((e.target as IDBRequest).error)
    })
  }

  async exportConversation(conversationId: string | null): Promise<{ nodes: ConversationNode[]; edges: ConversationEdge[] }> {
    const nodes = conversationId
      ? await this.getNodesByConversation(conversationId)
      : await this.getAllNodes()
    const edges: ConversationEdge[] = nodes
      .filter(n => n.parentId)
      .map(n => ({ source: n.parentId!, target: n.id }))
    return { nodes, edges }
  }
}
