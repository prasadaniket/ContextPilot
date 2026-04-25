const STOP = new Set([
  'the','a','an','is','it','in','on','at','to','for','of','and','or','but',
  'i','you','we','this','that','with','can','how','what','my','your','do',
  'did','was','are','be','have','has','had','not','so','if','as','by','from',
  'will','would','should','could','may','might','just','then','than','when',
  'here','there','their','they','them','these','those','more','some','all',
  'get','got','set','use','let','one','two','its','also','been','into',
])

export function extractKeywords(text: string, n = 8): string[] {
  const words = (text || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP.has(w))
  const freq: Record<string, number> = {}
  for (const w of words) freq[w] = (freq[w] || 0) + 1
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w)
}

export function scoreRelevance(keywords: string[], query: string): number {
  const qWords = new Set(extractKeywords(query, 20))
  const nWords = new Set(keywords)
  let score = 0
  for (const w of qWords) if (nWords.has(w)) score++
  return score
}

export function findTopNodes<T extends { keywords: string[]; timestamp: number }>(
  nodes: T[],
  query: string,
  k = 2,
): T[] {
  return [...nodes]
    .map(n => ({ node: n, score: scoreRelevance(n.keywords, query) }))
    .sort((a, b) => b.score - a.score || b.node.timestamp - a.node.timestamp)
    .slice(0, k)
    .map(x => x.node)
}

export async function updateKeywordIndex(
  nodeId: string,
  keywords: string[],
): Promise<void> {
  const stored = await chrome.storage.local.get('cp_kw_index')
  const idx: Record<string, string[]> = (stored as Record<string, unknown>).cp_kw_index as Record<string, string[]> ?? {}
  for (const kw of keywords) {
    idx[kw] = [...new Set([...(idx[kw] ?? []), nodeId])]
  }
  await chrome.storage.local.set({ cp_kw_index: idx })
}

export async function queryKeywordIndex(tokens: string[]): Promise<Map<string, number>> {
  const stored = await chrome.storage.local.get('cp_kw_index')
  const idx: Record<string, string[]> = (stored as Record<string, unknown>).cp_kw_index as Record<string, string[]> ?? {}
  const hits = new Map<string, number>()
  for (const t of tokens) {
    for (const id of (idx[t] ?? [])) hits.set(id, (hits.get(id) ?? 0) + 1)
  }
  return hits
}

export function dateCutoff(range: string): number {
  const now = Date.now()
  switch (range) {
    case 'today': return now - 86_400_000
    case 'week':  return now - 604_800_000
    case 'month': return now - 2_592_000_000
    default:      return 0
  }
}
