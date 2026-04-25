import { MessageBridge } from './MessageBridge'
import type { CPState }  from './index'

type RequestBody = {
  messages?: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>
  [key: string]: unknown
}

export class FetchInterceptor {
  private original = window.fetch.bind(window)
  private pattern  = /\/api\/organizations\/.*\/chat_conversations\/.*\/completion/

  constructor(private state: CPState) {}

  install(): void {
    const self = this
    window.fetch = async function(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
      const urlStr = typeof input === 'string' ? input : (input as Request).url ?? ''
      if (!self.pattern.test(urlStr) || init?.method !== 'POST') {
        return self.original(input, init)
      }
      return self._intercept(input, urlStr, init)
    }
  }

  private async _intercept(input: RequestInfo | URL, urlStr: string, init: RequestInit): Promise<Response> {
    let originalBody: RequestBody | null = null
    let userMessage  = ''
    const conversationId = this._getConvId(urlStr)

    if (!this.state.commands?.paused) {
      try {
        originalBody = JSON.parse(init.body as string) as RequestBody
        userMessage  = this._extractUserMsg(originalBody)

        if (this.state.commands?.skipNext) {
          this.state.commands.skipNext = false
        } else {
          const lean = await MessageBridge.send({
            type: 'GET_LEAN_CONTEXT',
            payload: {
              originalBody,
              userMessage,
              conversationId,
              depth: this.state.commands?.contextDepth ?? 2,
            },
          })
          if (lean) init = { ...init, body: JSON.stringify(lean) }
        }
      } catch {
        if (originalBody) init = { ...init, body: JSON.stringify(originalBody) }
      }
    }

    const response    = await this.original(input, init)
    const tapResponse = response.clone()
    void this.state.sse?.read(tapResponse, { userMessage, conversationId, rawBody: originalBody as never })
    return response
  }

  private _extractUserMsg(body: RequestBody): string {
    const msgs = body?.messages ?? []
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'human') {
        const c = msgs[i].content
        if (typeof c === 'string') return c
        if (Array.isArray(c)) return (c as Array<{ type: string; text?: string }>).find(x => x.type === 'text')?.text ?? ''
      }
    }
    return ''
  }

  private _getConvId(url: string): string {
    const m = url.match(/chat_conversations\/([^/]+)/)
    return m ? 'conv_' + m[1] : 'conv_unknown_' + Date.now()
  }
}
