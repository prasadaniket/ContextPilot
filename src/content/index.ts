import { MessageBridge }   from './MessageBridge'
import { TokenCounter }    from './TokenCounter'
import { UsageParser }     from './UsageParser'
import { HUDDisplay }      from './HUDDisplay'
import { TreePanel }       from './TreePanel'
import { CommandRouter }   from './CommandRouter'
import { SSEReader }       from './SSEReader'
import { FetchInterceptor }from './FetchInterceptor'

// Prevent double-injection across SPA navigations
if ((window as unknown as { __CP_LOADED__: boolean }).__CP_LOADED__) {
  // already running — do nothing
} else {
  (window as unknown as { __CP_LOADED__: boolean }).__CP_LOADED__ = true

  // ── API KEY GRABBER (console.anthropic.com only) ────────────────────────
  if (window.location.hostname.includes('console.anthropic.com')) {
    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (msg.type !== 'TRIGGER_GRAB') return
      void (async () => {
        await new Promise(r => setTimeout(r, 1500))
        const selectors = [
          'input[readonly][value^="sk-ant-"]',
          'input[value^="sk-ant-"]',
          '[data-testid="api-key-value"]',
        ]
        let key: string | null = null
        for (const sel of selectors) {
          const el = document.querySelector(sel) as HTMLInputElement | null
          if (el) {
            const m = (el.value || el.textContent || '').match(/sk-ant-[A-Za-z0-9\-_]+/)
            if (m) { key = m[0]; break }
          }
        }
        if (!key) {
          const m = document.body.innerText.match(/sk-ant-[A-Za-z0-9\-_]{40,}/)
          key = m ? m[0] : null
        }
        if (key) chrome.runtime.sendMessage({ type: 'API_KEY_CAPTURED', key })
        reply({ success: !!key })
      })()
      return true
    })
  } else if (window.location.hostname.includes('claude.ai')) {

    // ── Shared state container ────────────────────────────────────────────
    // Exported type so other modules can reference it without circular deps
    const state: CPState = {} as CPState

    // Boot all modules
    state.usage    = new UsageParser()
    state.hud      = new HUDDisplay()
    state.panel    = new TreePanel()
    state.commands = new CommandRouter(state)
    state.sse      = new SSEReader(state)
    state.fetch    = new FetchInterceptor(state)

    // Expose globally for HUD tree-toggle click
    ;(window as unknown as { CP: CPState }).CP = state

    state.hud.inject()
    state.commands.watch()
    state.fetch.install()

    // Re-inject HUD on SPA navigation (claude.ai is React)
    new MutationObserver(() => {
      if (!document.getElementById('cp-hud')) state.hud?.inject()
    }).observe(document.body, { childList: true, subtree: false })

    // Load initial stats
    MessageBridge.send({ type: 'GET_STATS' }).then((stats: unknown) => {
      const s = stats as { tokensSaved?: number } | null
      if (s?.tokensSaved) state.hud?.update({ tokensSaved: s.tokensSaved })
    }).catch(() => {})

    console.log('[ContextPilot v3.0] loaded — TypeScript + esbuild, 8 modules')
  }
}

// Shared state type (defined here to avoid circular imports)
export interface CPState {
  usage?:    UsageParser
  hud?:      HUDDisplay
  panel?:    TreePanel
  commands?: CommandRouter
  sse?:      SSEReader
  fetch?:    FetchInterceptor
}

// Re-export TokenCounter so SSEReader can import without circular dep
export { TokenCounter }
