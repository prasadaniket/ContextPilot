import { MessageBridge } from './MessageBridge'
import type { CPState } from './index'

export class CommandRouter {
  paused       = false
  skipNext     = false
  contextDepth = 2

  constructor(private state: CPState) {}

  watch(): void {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return
      const ta = this._getTextarea()
      if (!ta) return
      const text = (ta.textContent || (ta as HTMLInputElement).value || '').trim()
      if (!text.startsWith('/cp')) return
      e.preventDefault()
      e.stopImmediatePropagation()
      void this._route(text)
      this._clear(ta)
    }, true)
  }

  private _getTextarea(): HTMLElement | null {
    return document.querySelector('[data-testid="chat-input"]') ||
           document.querySelector('div[contenteditable="true"]') ||
           document.querySelector('textarea')
  }

  private _clear(el: HTMLElement): void {
    if ((el as HTMLInputElement).tagName === 'TEXTAREA') (el as HTMLInputElement).value = ''
    else el.textContent = ''
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  private async _route(raw: string): Promise<void> {
    const [cmd, ...args] = raw.trim().split(/\s+/)
    switch (cmd.toLowerCase()) {
      case '/cp':
      case '/cp-status': return this._cmdStatus()
      case '/cp-tree':   return this.state.panel?.toggle()
      case '/cp-skip':   return this._cmdSkip()
      case '/cp-pause':  return this._cmdPause()
      case '/cp-resume': return this._cmdResume()
      case '/cp-reset':  return this._cmdReset()
      case '/cp-export': return this._cmdExport()
      case '/cp-mode':   return this._cmdMode(args[0])
      case '/cp-help':   return this._cmdHelp()
      default: this._say('Unknown: ' + cmd + '\nType /cp-help')
    }
  }

  private async _cmdStatus(): Promise<void> {
    const stats  = await MessageBridge.send({ type: 'GET_STATS' }) as Record<string, number> | null ?? {}
    const stored = await new Promise<Record<string, unknown>>(r =>
      chrome.storage.local.get(['cp_session_usage','cp_weekly_usage','cp_cache_expires','cp_token_count'], r as never))
    const K = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n || 0)
    const P = (f: unknown) => f != null ? Math.round(Number(f) * 100) + '%' : '—'
    const rem = stored.cp_cache_expires ? Math.max(0, Number(stored.cp_cache_expires) - Date.now()) : 0
    const fmt = (ms: number) => { const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000); return m > 0 ? `${m}m ${s}s` : `${s}s` }
    this._say([
      'ContextPilot v3.0 — session',
      '─'.repeat(34),
      'Nodes:      ' + K(stats.totalNodes || 0),
      'Saved:      ' + K(stats.tokensSaved || 0) + ' tokens',
      'Ratio:      ' + (stats.compressionRatio || 0) + '%',
      'Avg quality:' + (stats.avgQualityScore || 0) + '/100',
      'Session:    ' + P(stored.cp_session_usage),
      'Weekly:     ' + P(stored.cp_weekly_usage),
      'Cache:      ' + fmt(rem),
      'Mode:       depth-' + this.contextDepth,
      'Status:     ' + (this.paused ? 'PAUSED' : 'active'),
      '─'.repeat(34),
      '/cp-help for all commands',
    ].join('\n'))
  }

  private _cmdSkip():   void { this.skipNext = true;  this._say('Next message: compression SKIPPED') }
  private _cmdPause():  void { this.paused   = true;  this._say('Compression PAUSED. /cp-resume to restart.') }
  private _cmdResume(): void { this.paused   = false; this._say('Compression RESUMED.') }

  private async _cmdReset(): Promise<void> {
    const m = window.location.href.match(/\/chat\/([a-f0-9-]+)/)
    if (!m) { this._say('Could not find conversation ID.'); return }
    await MessageBridge.send({ type: 'CLEAR_CONVERSATION', payload: { conversationId: 'conv_' + m[1] } })
    this._say('Tree cleared for this conversation.')
  }

  private async _cmdExport(): Promise<void> {
    const m    = window.location.href.match(/\/chat\/([a-f0-9-]+)/)
    const data = await MessageBridge.send({ type: 'EXPORT_CONVERSATION', payload: { conversationId: m ? 'conv_' + m[1] : null } }) as { nodes?: unknown[] } | null
    if (!data?.nodes) { this._say('No data to export yet.'); return }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'cp-tree-' + Date.now() + '.json' })
    a.click(); URL.revokeObjectURL(a.href)
    this._say('Exported ' + data.nodes.length + ' nodes.')
  }

  private _cmdMode(arg: string): void {
    const map: Record<string, number> = { light: 1, normal: 2, deep: 3 }
    this.contextDepth = map[arg?.toLowerCase()] ?? 2
    const names: Record<number, string> = { 1: 'light (1 node)', 2: 'normal (2 nodes)', 3: 'deep (3 nodes)' }
    this._say('Mode: ' + names[this.contextDepth])
  }

  private _cmdHelp(): void {
    this._say([
      'ContextPilot v3.0 commands',
      '─'.repeat(36),
      '/cp              Show status',
      '/cp-tree         Toggle graph sidebar',
      '/cp-skip         Skip next compression',
      '/cp-pause        Pause all compression',
      '/cp-resume       Resume compression',
      '/cp-reset        Clear this conversation tree',
      '/cp-export       Download tree as JSON',
      '/cp-mode light   Use 1 context node',
      '/cp-mode deep    Use 3 context nodes',
      '/cp-help         This help message',
      '─'.repeat(36),
      'Commands handled locally — never sent to Claude.',
    ].join('\n'))
  }

  private _say(text: string): void {
    const list = document.querySelector('[data-testid="conversation-content"]') ||
                 document.querySelector('div.flex-col') || document.body
    const el = Object.assign(document.createElement('div'), { className: 'cp-cmd-msg', textContent: text })
    list.appendChild(el)
    el.scrollIntoView({ behavior: 'smooth', block: 'end' })
    setTimeout(() => el.remove(), 30000)
  }
}
