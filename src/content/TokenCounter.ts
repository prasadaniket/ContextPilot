declare const GPTTokenizer_o200k_base: { encode(text: string): number[] } | undefined

export class TokenCounter {
  static count(text: string): number {
    try {
      if (typeof GPTTokenizer_o200k_base !== 'undefined') {
        return GPTTokenizer_o200k_base.encode(text || '').length
      }
    } catch { /* fallback */ }
    return Math.ceil((text || '').length / 4)
  }

  static countMessages(
    messages: Array<{ role: string; content: string | Array<{ text?: string }> }>,
    assistantReply = '',
  ): number {
    let total = 0
    for (const msg of messages ?? []) {
      const text = typeof msg.content === 'string'
        ? msg.content
        : (msg.content as Array<{ text?: string }>).map(c => c.text ?? '').join(' ')
      total += this.count(text)
    }
    if (assistantReply) total += this.count(assistantReply)
    return total
  }
}
