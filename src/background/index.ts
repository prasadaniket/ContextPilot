import { TreeStore }          from './TreeStore'
import { ContextBuilder }     from './ContextBuilder'
import { Compressor }         from './Compressor'
import { scoreNode, aggregateGrade, reportNode } from './QualityScorer'
import { computeBlastRadii }  from './BlastRadiusCalc'
import {
  extractKeywords,
  findTopNodes,
  updateKeywordIndex,
  queryKeywordIndex,
  dateCutoff,
} from './KeywordExtractor'
import type { ConversationNode, CPMessage, DateRange } from '../shared/types'

// Compute a simple semantic hash (first 8 chars of base64-encoded length+content)
function semanticHash(text: string): string {
  let h = 0
  for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0
  return Math.abs(h).toString(16).slice(0, 8)
}

class BackgroundController {
  private store    = new TreeStore()
  private builder  = new ContextBuilder()
  private compress = new Compressor()
  private grabTab: number | null = null

  listen() {
    chrome.runtime.onMessage.addListener((msg: CPMessage, _sender, sendResponse) => {
      this.handle(msg)
        .then(sendResponse)
        .catch(err => sendResponse({ error: (err as Error).message }))
      return true
    })
  }

  private async handle(msg: CPMessage): Promise<unknown> {
    switch (msg.type) {
      case 'GET_LEAN_CONTEXT':    return this.getLeanContext(msg.payload)
      case 'COMPRESS_EXCHANGE':   return this.compressExchange(msg.payload)
      case 'GET_STATS':           return this.store.getAllStats()
      case 'GET_GRAPH_DATA':      return this.getGraphData(msg.payload)
      case 'EXPORT_CONVERSATION': return this.store.exportConversation(msg.payload.conversationId)
      case 'CLEAR_CONVERSATION':  return this.clearConv(msg.payload)
      case 'CLEAR_ALL':           return this.clearAll()
      case 'SAVE_API_KEY':        return this.saveApiKey(msg.payload)
      case 'GET_API_KEY_STATUS':  return this.getApiKeyStatus()
      case 'GRAB_API_KEY':        return this.grabApiKey()
      case 'API_KEY_CAPTURED':    return this.onApiKeyCaptured(msg.key)
      case 'COMPUTE_BLAST_RADIUS':return this.computeBlastRadius(msg.payload)
      case 'GET_QUALITY_SCORE':   return this.getQualityScore(msg.payload)
      case 'SEARCH_NODES':        return this.searchNodes(msg.payload)
      default: return { error: 'Unknown message type' }
    }
  }

  private async getLeanContext(payload: { originalBody: unknown; userMessage: string; conversationId: string; depth?: number }) {
    try {
      const nodes = await this.store.getNodesByConversation(payload.conversationId)
      if (!nodes.length) return null
      const top = findTopNodes(nodes, payload.userMessage, payload.depth ?? 2)
      return this.builder.buildLeanPayload(payload.originalBody as never, top, payload.userMessage)
    } catch { return null }
  }

  private async compressExchange(payload: { userMessage: string; assistantMessage: string; conversationId: string }) {
    try {
      const rawText           = `User: ${payload.userMessage}\n\nAssistant: ${payload.assistantMessage}`
      const rawTokenEstimate  = Math.ceil(rawText.length / 4)
      const { cp_api_key }    = await chrome.storage.local.get('cp_api_key') as { cp_api_key?: string }
      let compressed          = ''
      let confidence: ConversationNode['confidence'] = 'INFERRED'

      if (cp_api_key) {
        compressed = await this.compress.compress(rawText, cp_api_key)
        confidence = 'EXTRACTED'
      } else {
        compressed = this.compress.naive(rawText)
      }

      const compressedTokenEstimate = Math.ceil(compressed.length / 4)
      const existing  = await this.store.getNodesByConversation(payload.conversationId)
      const parentId  = existing.length > 0 ? existing[existing.length - 1].id : null
      const keywords  = extractKeywords(rawText)

      const node: ConversationNode = {
        id:                   `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        conversationId:       payload.conversationId,
        parentId,
        compressed,
        keywords,
        rawTokenEstimate,
        compressedTokenEstimate,
        timestamp:            Date.now(),
        turnIndex:            existing.length,
        community:            0,
        relationTypes:        ['follows'],
        confidence,
        blastRadius:          0,
        semanticHash:         semanticHash(compressed),
        qualityScore:         0,
      }
      node.qualityScore = scoreNode(node)

      await this.store.saveNode(node)
      await updateKeywordIndex(node.id, keywords)

      // Compute blast radii for this conversation asynchronously
      this.computeBlastRadius({ conversationId: payload.conversationId }).catch(() => {})

      const updated       = await this.store.getNodesByConversation(payload.conversationId)
      const activeNodeIds = updated.slice(-3).map(n => n.id)
      return { success: true, nodeId: node.id, activeNodeIds }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  }

  private async getGraphData(payload: { conversationId: string }) {
    try {
      const nodes = await this.store.getNodesByConversation(payload.conversationId)
      const last  = nodes[nodes.length - 1]
      const tagged = nodes.map(n => ({ ...n, isCurrent: last ? n.id === last.id : false }))
      const edges  = nodes.filter(n => n.parentId).map(n => ({ source: n.parentId!, target: n.id }))
      return { nodes: tagged, edges }
    } catch { return { nodes: [], edges: [] } }
  }

  private async clearConv(payload: { conversationId: string }) {
    try { await this.store.clearConversation(payload.conversationId); return { success: true } }
    catch (e) { return { success: false, error: (e as Error).message } }
  }

  private async clearAll() {
    try { await this.store.clearAll(); return { success: true } }
    catch (e) { return { success: false, error: (e as Error).message } }
  }

  private async saveApiKey(payload: { apiKey: string }) {
    if (!payload.apiKey?.startsWith('sk-ant-')) {
      return { success: false, error: 'Invalid API key (must start with sk-ant-)' }
    }
    try { await chrome.storage.local.set({ cp_api_key: payload.apiKey }); return { success: true } }
    catch (e) { return { success: false, error: (e as Error).message } }
  }

  private async getApiKeyStatus() {
    try {
      const { cp_api_key } = await chrome.storage.local.get('cp_api_key') as { cp_api_key?: string }
      if (!cp_api_key) return { isSet: false, maskedKey: null }
      return { isSet: true, maskedKey: `sk-ant-...${cp_api_key.slice(-4)}` }
    } catch { return { isSet: false, maskedKey: null } }
  }

  private async grabApiKey() {
    try {
      const tab = await chrome.tabs.create({ url: 'https://console.anthropic.com/settings/keys', active: true })
      this.grabTab = tab.id ?? null
      return { success: true, message: 'Opening Anthropic console…' }
    } catch (e) { return { success: false, error: (e as Error).message } }
  }

  private async onApiKeyCaptured(key: string) {
    if (!key) return { success: false }
    try {
      await chrome.storage.local.set({ cp_api_key: key })
      if (this.grabTab) { chrome.tabs.remove(this.grabTab).catch(() => {}); this.grabTab = null }
      return { success: true }
    } catch (e) { return { success: false, error: (e as Error).message } }
  }

  private async computeBlastRadius(payload: { conversationId: string }) {
    try {
      const nodes  = await this.store.getNodesByConversation(payload.conversationId)
      const radii  = computeBlastRadii(nodes)
      for (const [id, radius] of radii) {
        await this.store.updateNode(id, { blastRadius: radius })
      }
      return { success: true }
    } catch (e) { return { success: false, error: (e as Error).message } }
  }

  private async getQualityScore(payload: { conversationId: string }) {
    try {
      const nodes = await this.store.getNodesByConversation(payload.conversationId)
      if (!nodes.length) return { score: 0, grade: 'D', breakdown: null }
      const last = nodes[nodes.length - 1]
      return reportNode(last)
    } catch { return { score: 0, grade: 'D', breakdown: null } }
  }

  private async searchNodes(payload: { query: string; dateRange?: DateRange; limit?: number }) {
    try {
      const tokens    = extractKeywords(payload.query, 10)
      const hits      = await queryKeywordIndex(tokens)
      const cutoff    = dateCutoff(payload.dateRange ?? 'all')
      const candidates = await this.store.getNodesByIds([...hits.keys()], cutoff)
      const results = candidates
        .sort((a, b) =>
          (b.qualityScore * (1 + b.blastRadius)) - (a.qualityScore * (1 + a.blastRadius)))
        .slice(0, payload.limit ?? 10)
        .map(n => ({
          node: n,
          matchedKeywords: tokens.filter(t => n.keywords.includes(t)),
          relevanceScore: hits.get(n.id) ?? 0,
        }))
      return { results }
    } catch (e) { return { results: [], error: (e as Error).message } }
  }
}

const controller = new BackgroundController()
controller.listen()

console.log('[ContextPilot v3.0] service worker started — TypeScript + esbuild')

// Trigger quality score + blast radius computation for all convs on startup
chrome.storage.local.get('cp_known_convs').then((data) => {
  const convs = (data as Record<string, unknown>).cp_known_convs as string[] ?? []
  for (const convId of convs) {
    chrome.runtime.sendMessage({ type: 'COMPUTE_BLAST_RADIUS', payload: { conversationId: convId } })
      .catch(() => {})
  }
}).catch(() => {})
