import { MessageBridge }  from './MessageBridge'
import { TokenCounter }   from './TokenCounter'
import { gradeFromScore } from '../background/QualityScorer'
import type { CPState }   from './index'

interface SSEPayload {
  userMessage:    string
  conversationId: string
  rawBody:        { messages: Array<{ role: string; content: string | Array<{ text?: string }> }> } | null
}

export class SSEReader {
  constructor(private state: CPState) {}

  async read(response: Response, payload: SSEPayload): Promise<void> {
    const reader  = response.body!.getReader()
    const decoder = new TextDecoder()
    let assistantText = ''
    let done = false

    try {
      while (!done) {
        const { value, done: d } = await reader.read()
        done = d
        if (!value) continue
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (raw === '[DONE]') { done = true; break }
          let evt: Record<string, unknown>
          try { evt = JSON.parse(raw) } catch { continue }
          if (evt?.type === 'message_limit') this.state.usage?.parse(evt)
          const delta = evt?.delta as Record<string, unknown> | undefined
          if (delta?.type === 'text_delta' && delta?.text) assistantText += delta.text as string
        }
      }
    } catch { /* stream may close early */ }

    const cacheExpiresAt = Date.now() + 5 * 60 * 1000
    chrome.storage.local.set({ cp_cache_expires: cacheExpiresAt })
    this.state.hud?.update({ cacheExpiresAt })

    if (payload.rawBody) {
      const count = TokenCounter.countMessages(payload.rawBody.messages, assistantText)
      chrome.storage.local.set({ cp_token_count: count })
      this.state.hud?.update({ tokenCount: count })
    }

    await this.state.usage?.persist()
    this.state.hud?.update({
      sessionUsage: this.state.usage?.sessionUsage,
      weeklyUsage:  this.state.usage?.weeklyUsage,
    })

    if (assistantText && payload.userMessage && !this.state.commands?.paused) {
      try {
        const result = await MessageBridge.send({
          type: 'COMPRESS_EXCHANGE',
          payload: {
            userMessage:      payload.userMessage,
            assistantMessage: assistantText,
            conversationId:   payload.conversationId,
          },
        }) as { success?: boolean; activeNodeIds?: string[] } | null

        if (result?.success) {
          const stats = await MessageBridge.send({ type: 'GET_STATS' }) as { tokensSaved?: number; avgQualityScore?: number } | null
          if (stats?.tokensSaved) this.state.hud?.update({ tokensSaved: stats.tokensSaved })

          // Update quality grade in HUD
          const qualityReport = await MessageBridge.send({
            type: 'GET_QUALITY_SCORE',
            payload: { conversationId: payload.conversationId },
          }) as { score?: number } | null
          if (qualityReport?.score != null) {
            this.state.hud?.update({ qualityGrade: gradeFromScore(qualityReport.score) })
          }

          void this.state.panel?.refresh(result.activeNodeIds ?? [])
        }
      } catch { /* non-fatal */ }
    }
  }
}
