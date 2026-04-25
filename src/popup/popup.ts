import type { Stats, SearchResult } from '../shared/types'

document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadCompressionStats(), loadUsageData(), loadApiKeyStatus()])
  bindEvents()
})

async function loadCompressionStats(): Promise<void> {
  try {
    const stats = await msg<Stats>({ type: 'GET_STATS' })
    if (!stats) return
    set('tokensSaved',      formatK(stats.tokensSaved))
    set('compressionRatio', stats.compressionRatio > 0 ? `${stats.compressionRatio}%` : '—')
    set('totalNodes',       formatK(stats.totalNodes))
    set('chatCount',        formatK(stats.conversationCount))
    set('avgQuality',       stats.avgQualityScore ? `${stats.avgQualityScore}/100` : '—')
  } catch (err) { console.warn('[CP Popup] stats:', (err as Error).message) }
}

async function loadUsageData(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get([
      'cp_session_usage', 'cp_weekly_usage',
      'cp_session_reset_ms', 'cp_weekly_reset_ms',
      'cp_token_count', 'cp_cache_expires',
    ]) as Record<string, number>

    const tokens = stored.cp_token_count ?? 0
    set('tokenCount', `${formatK(tokens)} / 200K tokens`)
    setBar('tokenBar', Math.min(100, Math.round((tokens / 200_000) * 100)))

    if (stored.cp_session_usage != null) {
      const p = Math.round(stored.cp_session_usage * 100)
      set('sessionPct', `${p}%`)
      setBar('sessionBar', p)
      if (stored.cp_session_reset_ms > 0) set('sessionReset', `resets in ${formatMs(stored.cp_session_reset_ms)}`)
    }
    if (stored.cp_weekly_usage != null) {
      const p = Math.round(stored.cp_weekly_usage * 100)
      set('weeklyPct', `${p}%`)
      setBar('weeklyBar', p)
      if (stored.cp_weekly_reset_ms > 0) set('weeklyReset', `resets in ${formatMs(stored.cp_weekly_reset_ms)}`)
    }
    if (stored.cp_cache_expires) {
      const rem = stored.cp_cache_expires - Date.now()
      set('cacheTimer', rem > 0 ? formatMs(rem) : 'expired')
    }
  } catch (err) { console.warn('[CP Popup] usage:', (err as Error).message) }
}

async function loadApiKeyStatus(): Promise<void> {
  try {
    const res = await msg<{ isSet: boolean; maskedKey: string | null }>({ type: 'GET_API_KEY_STATUS' })
    if (!res) return
    const input = document.getElementById('apiInput') as HTMLInputElement
    if (res.isSet) {
      input.placeholder = res.maskedKey ?? ''
      showStatus('API key set — full compression active', 'ok')
    } else {
      showStatus('No API key — using basic compression fallback', '')
    }
  } catch { /* ignore */ }
}

function bindEvents(): void {
  document.getElementById('saveBtn')?.addEventListener('click', async () => {
    const key = (document.getElementById('apiInput') as HTMLInputElement).value.trim()
    if (!key) { showStatus('Enter your API key first', 'err'); return }
    const result = await msg<{ success: boolean; error?: string }>({ type: 'SAVE_API_KEY', payload: { apiKey: key } })
    if (result?.success) {
      (document.getElementById('apiInput') as HTMLInputElement).value = ''
      showStatus('Saved', 'ok')
      await loadApiKeyStatus()
    } else {
      showStatus(result?.error ?? 'Failed to save', 'err')
    }
  })

  const grabBtn = document.getElementById('grabBtn') as HTMLButtonElement
  grabBtn?.addEventListener('click', async () => {
    grabBtn.textContent = 'Opening console…'
    grabBtn.disabled    = true
    try {
      const result = await msg<{ success: boolean; error?: string }>({ type: 'GRAB_API_KEY' })
      if (result?.success) {
        showStatus('Console opened — key will be saved automatically', 'ok')
      } else {
        showStatus(result?.error ?? 'Could not open console', 'err')
        grabBtn.textContent = '✳ Get key automatically'
        grabBtn.disabled    = false
      }
    } catch (e) {
      showStatus('Error: ' + (e as Error).message, 'err')
      grabBtn.textContent = '✳ Get key automatically'
      grabBtn.disabled    = false
    }
    setTimeout(() => { grabBtn.textContent = '✳ Get key automatically'; grabBtn.disabled = false }, 8000)
  })

  document.getElementById('clearBtn')?.addEventListener('click', async () => {
    if (!confirm('Clear all ContextPilot data? This cannot be undone.')) return
    const result = await msg<{ success: boolean }>({ type: 'CLEAR_ALL' })
    if (result?.success) { await loadCompressionStats(); showStatus('All data cleared', 'ok') }
  })

  // Search
  let searchTimer: ReturnType<typeof setTimeout>
  document.getElementById('searchInput')?.addEventListener('input', (e) => {
    clearTimeout(searchTimer)
    const q = (e.target as HTMLInputElement).value.trim()
    if (!q) { clearResults(); return }
    searchTimer = setTimeout(() => void runSearch(q), 300)
  })

  document.getElementById('dateFilter')?.addEventListener('change', () => {
    const q = (document.getElementById('searchInput') as HTMLInputElement).value.trim()
    if (q) void runSearch(q)
  })
}

async function runSearch(query: string): Promise<void> {
  const dateRange = (document.getElementById('dateFilter') as HTMLSelectElement).value as 'today' | 'week' | 'month' | 'all'
  try {
    const res = await msg<{ results: SearchResult[] }>({
      type: 'SEARCH_NODES',
      payload: { query, dateRange, limit: 8 },
    })
    renderResults(res?.results ?? [])
  } catch { clearResults() }
}

function renderResults(results: SearchResult[]): void {
  const container = document.getElementById('searchResults')
  if (!container) return
  if (!results.length) {
    container.innerHTML = '<div class="search-empty">No matches found</div>'
    return
  }
  container.innerHTML = results.map(r => {
    const n       = r.node
    const convId  = n.conversationId.replace('conv_', '')
    const preview = (n.compressed ?? '').slice(0, 60)
    const kws     = r.matchedKeywords.slice(0, 3).join(', ')
    return `<div class="search-result" data-conv="${convId}">
      <div class="sr-top">
        <span class="sr-turn">Turn ${(n.turnIndex ?? 0) + 1}</span>
        <span class="sr-badge" style="color:${qualityColor(n.qualityScore)}">Q${n.qualityScore}</span>
        <span class="sr-blast">⊕${Math.round((n.blastRadius ?? 0) * 100)}%</span>
      </div>
      <div class="sr-preview">${preview}…</div>
      ${kws ? `<div class="sr-kws">${kws}</div>` : ''}
    </div>`
  }).join('')

  container.querySelectorAll<HTMLElement>('.search-result').forEach(el => {
    el.addEventListener('click', () => {
      const convId = el.dataset.conv
      if (convId) chrome.tabs.create({ url: `https://claude.ai/chat/${convId}` })
    })
  })
}

function clearResults(): void {
  const c = document.getElementById('searchResults')
  if (c) c.innerHTML = ''
}

function qualityColor(score: number): string {
  return score >= 80 ? '#1D9E75' : score >= 60 ? '#534AB7' : score >= 40 ? '#BA7517' : '#C4622D'
}

function msg<T>(message: unknown): Promise<T | null> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (res: T) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
      else resolve(res ?? null)
    })
  })
}

function set(id: string, val: string): void {
  const el = document.getElementById(id)
  if (el) el.textContent = val
}

function setBar(id: string, pct: number): void {
  const el = document.getElementById(id) as HTMLElement | null
  if (el) el.style.width = `${Math.min(100, pct)}%`
}

function showStatus(text: string, cls: string): void {
  const el = document.getElementById('apiStatus')
  if (!el) return
  el.textContent  = text
  el.className    = `api-status ${cls}`
}

function formatK(n: number): string {
  if (!n) return '0'
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n)
}

function formatMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}
