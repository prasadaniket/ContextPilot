import type { ConversationNode } from '../shared/types'

interface ClaudeBody {
  messages?: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>
  [key: string]: unknown
}

export class ContextBuilder {
  buildLeanPayload(
    originalBody: ClaudeBody,
    topNodes: ConversationNode[],
    _userMsg: string,
  ): ClaudeBody | null {
    if (!topNodes.length) return null

    const contextBlock = topNodes
      .map((n, i) => `[Context ${i + 1}]: ${n.compressed}`)
      .join('\n\n')
    const prefix = `<context_summary>\n${contextBlock}\n</context_summary>\n\nCurrent request:`

    const messages = originalBody.messages ?? []
    const humanMsgs = messages.filter(m => m.role === 'human')
    const latest = humanMsgs[humanMsgs.length - 1]
    if (!latest) return null

    const latestText = typeof latest.content === 'string'
      ? latest.content
      : (latest.content as Array<{ type: string; text?: string }>)
          .map(c => c.text ?? '')
          .join(' ')

    return {
      ...originalBody,
      messages: [{ role: 'human', content: `${prefix}\n\n${latestText}` }],
    }
  }
}
