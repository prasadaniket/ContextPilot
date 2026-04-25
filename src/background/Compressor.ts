const COMPRESSION_PROMPT = `You are a lossless conversation compressor.
Summarize this exchange in UNDER 80 tokens.
PRESERVE: key decisions, facts, code, task context, named entities, numbers.
DISCARD: greetings, filler, repetition, politeness.
Output ONLY the summary. No preamble, no labels, no quotes.`

export class Compressor {
  async compress(rawText: string, apiKey: string): Promise<string> {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 120,
        messages: [{ role: 'user', content: `${COMPRESSION_PROMPT}\n\n${rawText}` }],
      }),
    })
    if (!resp.ok) throw new Error(`Anthropic API ${resp.status}`)
    const data = await resp.json() as { content?: Array<{ text?: string }> }
    return data?.content?.[0]?.text ?? ''
  }

  naive(rawText: string): string {
    return rawText.length > 400 ? rawText.slice(0, 400) + '…[truncated]' : rawText
  }
}
