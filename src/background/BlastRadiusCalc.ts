import type { ConversationNode } from '../shared/types'

export function computeBlastRadii(nodes: ConversationNode[]): Map<string, number> {
  if (nodes.length <= 1) {
    return new Map(nodes.map(n => [n.id, 0]))
  }

  const keywordSets = new Map(nodes.map(n => [n.id, new Set(n.keywords)]))
  const affects     = new Map<string, Set<string>>()

  for (const a of nodes) {
    for (const b of nodes) {
      if (a.id === b.id) continue
      const aKws = keywordSets.get(a.id)!
      const bKws = keywordSets.get(b.id)!
      let overlap = 0
      for (const k of aKws) if (bKws.has(k)) overlap++
      if (overlap >= 2) {
        if (!affects.has(a.id)) affects.set(a.id, new Set())
        affects.get(a.id)!.add(b.id)
      }
    }
  }

  for (const n of nodes) {
    if (n.parentId) {
      if (!affects.has(n.parentId)) affects.set(n.parentId, new Set())
      affects.get(n.parentId)!.add(n.id)
    }
  }

  const radii = new Map<string, number>()
  for (const n of nodes) {
    const visited = new Set<string>()
    let frontier  = [n.id]
    for (let hop = 0; hop < 3 && frontier.length > 0; hop++) {
      const next: string[] = []
      for (const id of frontier) {
        for (const dep of (affects.get(id) ?? [])) {
          if (!visited.has(dep)) { visited.add(dep); next.push(dep) }
        }
      }
      frontier = next
    }
    radii.set(n.id, visited.size / (nodes.length - 1))
  }
  return radii
}
