import type { ConversationNode, QualityGrade, QualityReport } from '../shared/types'

export function scoreNode(node: ConversationNode): number {
  const ratio = node.rawTokenEstimate > 0
    ? 1 - (node.compressedTokenEstimate / node.rawTokenEstimate)
    : 0
  const compressionPts = Math.round(Math.max(0, Math.min(1, ratio)) * 40)
  const richnessPts    = Math.round(Math.min(node.keywords.length / 8, 1) * 30)

  const ageMs = Date.now() - node.timestamp
  const freshnessPts =
    ageMs < 3_600_000   ? 30 :
    ageMs < 86_400_000  ? 25 :
    ageMs < 604_800_000 ? 15 : 5

  return compressionPts + richnessPts + freshnessPts
}

export function gradeFromScore(score: number): QualityGrade {
  return score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D'
}

export function reportNode(node: ConversationNode): QualityReport {
  const ratio = node.rawTokenEstimate > 0
    ? 1 - (node.compressedTokenEstimate / node.rawTokenEstimate)
    : 0
  const compressionPts = Math.round(Math.max(0, Math.min(1, ratio)) * 40)
  const richnessPts    = Math.round(Math.min(node.keywords.length / 8, 1) * 30)
  const ageMs          = Date.now() - node.timestamp
  const freshnessPts   =
    ageMs < 3_600_000   ? 30 :
    ageMs < 86_400_000  ? 25 :
    ageMs < 604_800_000 ? 15 : 5
  const score          = compressionPts + richnessPts + freshnessPts
  return { score, grade: gradeFromScore(score), breakdown: { compressionPts, richnessPts, freshnessPts } }
}

export function aggregateGrade(nodes: ConversationNode[]): QualityGrade {
  if (!nodes.length) return 'D'
  const avg = nodes.reduce((s, n) => s + (n.qualityScore || 0), 0) / nodes.length
  return gradeFromScore(Math.round(avg))
}
