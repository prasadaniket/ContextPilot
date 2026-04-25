export type RelationType = 'follows' | 'references' | 'contradicts' | 'elaborates'
export type Confidence   = 'EXTRACTED' | 'INFERRED'
export type QualityGrade = 'A' | 'B' | 'C' | 'D'
export type DateRange    = 'today' | 'week' | 'month' | 'all'

export interface ConversationNode {
  // v2 fields
  id: string
  conversationId: string
  parentId: string | null
  compressed: string
  keywords: string[]
  rawTokenEstimate: number
  compressedTokenEstimate: number
  timestamp: number
  turnIndex: number
  // v3 additions
  community: number
  relationTypes: RelationType[]
  confidence: Confidence
  blastRadius: number
  semanticHash: string
  qualityScore: number
  isCurrent?: boolean
}

export interface ConversationEdge {
  source: string
  target: string
}

export interface GraphData {
  nodes: ConversationNode[]
  edges: ConversationEdge[]
}

export interface SearchResult {
  node: ConversationNode
  matchedKeywords: string[]
  relevanceScore: number
}

export interface QualityReport {
  score: number
  grade: QualityGrade
  breakdown: { compressionPts: number; richnessPts: number; freshnessPts: number }
}

export interface Stats {
  totalNodes: number
  conversationCount: number
  tokensSaved: number
  compressionRatio: number
  avgQualityScore: number
}

// Message types for chrome.runtime.sendMessage
export type CPMessage =
  | { type: 'GET_LEAN_CONTEXT';    payload: { originalBody: unknown; userMessage: string; conversationId: string; depth?: number } }
  | { type: 'COMPRESS_EXCHANGE';   payload: { userMessage: string; assistantMessage: string; conversationId: string } }
  | { type: 'GET_STATS' }
  | { type: 'GET_GRAPH_DATA';      payload: { conversationId: string } }
  | { type: 'EXPORT_CONVERSATION'; payload: { conversationId: string | null } }
  | { type: 'CLEAR_CONVERSATION';  payload: { conversationId: string } }
  | { type: 'CLEAR_ALL' }
  | { type: 'SAVE_API_KEY';        payload: { apiKey: string } }
  | { type: 'GET_API_KEY_STATUS' }
  | { type: 'GRAB_API_KEY' }
  | { type: 'API_KEY_CAPTURED';    key: string }
  | { type: 'COMPUTE_BLAST_RADIUS'; payload: { conversationId: string } }
  | { type: 'GET_QUALITY_SCORE';   payload: { conversationId: string } }
  | { type: 'SEARCH_NODES';        payload: { query: string; dateRange?: DateRange; limit?: number } }
  | { type: 'TRIGGER_GRAB' }
