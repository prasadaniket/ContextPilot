import type { QualityGrade } from '../shared/types'

const GRADE_COLOR: Record<QualityGrade, string> = {
  A: '#4a4f42',
  B: '#6b6e63',
  C: '#7a7860',
  D: '#8a5248',
}

export class HUDDisplay {
  el:            HTMLElement | null = null
  tokenCount     = 0
  sessionUsage:  number | null      = null
  weeklyUsage:   number | null      = null
  cacheExpiresAt: number | null     = null
  tokensSaved    = 0
  qualityGrade:  QualityGrade       = 'D'
  private _interval: ReturnType<typeof setInterval> | null = null

  inject(): void {
    if (document.getElementById('cp-hud')) return
    this._injectStyles()
    this.el = document.createElement('div')
    this.el.id = 'cp-hud'
    this.el.innerHTML = `
      <div class="cp-cell">
        <span class="cp-lbl">Tokens</span>
        <span id="cp-tokens" class="cp-val">—</span>
        <div class="cp-bar-w"><div class="cp-bar-f cp-bar-gray" id="cp-bar-tok"></div></div>
      </div>
      <div class="cp-cell">
        <span class="cp-lbl">Session</span>
        <span id="cp-session" class="cp-val cp-blue">—</span>
        <div class="cp-bar-w"><div class="cp-bar-f cp-bar-blue" id="cp-bar-ses"></div></div>
      </div>
      <div class="cp-cell">
        <span class="cp-lbl">Weekly</span>
        <span id="cp-weekly" class="cp-val cp-amber">—</span>
        <div class="cp-bar-w"><div class="cp-bar-f cp-bar-amber" id="cp-bar-wk"></div></div>
      </div>
      <div class="cp-cell">
        <span class="cp-lbl">Cache</span>
        <span id="cp-cache" class="cp-val">—</span>
      </div>
      <div class="cp-cell">
        <span class="cp-lbl">Quality</span>
        <span id="cp-quality" class="cp-val" style="font-weight:700;">—</span>
      </div>
      <div class="cp-cell cp-saved-cell">
        <span class="cp-lbl">Saved</span>
        <span id="cp-saved" class="cp-val cp-coral">—</span>
      </div>
      <div class="cp-cell cp-tree-btn" id="cp-tree-toggle" title="/cp-tree">
        <span class="cp-lbl">Tree</span>
        <span class="cp-val" style="font-size:10px;">⊡</span>
      </div>
    `
    document.body.appendChild(this.el)
    document.getElementById('cp-tree-toggle')
      ?.addEventListener('click', () => (window as unknown as { CP: { panel?: { toggle(): void } } }).CP.panel?.toggle())
    this._interval = setInterval(() => this.refresh(), 1000)
  }

  private _injectStyles(): void {
    if (document.getElementById('cp-styles')) return
    const s = document.createElement('style')
    s.id = 'cp-styles'
    s.textContent = `
      #cp-hud {
        position:fixed;bottom:0;left:0;right:0;z-index:9999;
        display:flex;align-items:center;flex-wrap:nowrap;
        padding:4px 14px;
        background:rgba(204,201,190,0.97);
        backdrop-filter:blur(8px);
        border-top:0.5px solid rgba(74,79,66,0.12);
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        font-size:11px;user-select:none;
      }
      .cp-cell{display:flex;align-items:center;gap:5px;padding:3px 10px;border-right:0.5px solid rgba(74,79,66,0.1);}
      .cp-cell:last-child{border-right:none;}
      .cp-lbl{font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#9a9d95;}
      .cp-val{font-size:11px;font-weight:500;color:#4a4f42;}
      .cp-blue{color:#4a4f42;}.cp-amber{color:#7a7860;}.cp-coral{color:#8a5248;}
      .cp-bar-w{width:36px;height:2px;background:rgba(74,79,66,0.1);border-radius:1px;overflow:hidden;}
      .cp-bar-f{height:100%;border-radius:1px;transition:width .4s;}
      .cp-bar-gray{background:#8a8d84;}.cp-bar-blue{background:#4a4f42;}.cp-bar-amber{background:#7a7860;}
      .cp-saved-cell{background:rgba(74,79,66,0.06);border-radius:4px;padding:3px 8px;}
      .cp-tree-btn{cursor:pointer;margin-left:auto;opacity:.5;}
      .cp-tree-btn:hover{opacity:1;}
      #cp-sidebar {
        position:fixed;right:0;top:52px;bottom:36px;
        width:270px;z-index:9998;
        background:#ccc9be;
        border-left:0.5px solid rgba(74,79,66,0.12);
        display:flex;flex-direction:column;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        transition:transform .2s ease;
      }
      #cp-sidebar.hidden{transform:translateX(270px);}
      .cp-sb-hdr{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border-bottom:0.5px solid rgba(74,79,66,0.1);background:#d5d2c7;}
      .cp-sb-title{font-size:11px;font-weight:500;color:#4a4f42;}
      .cp-sb-badge{font-size:9px;padding:2px 7px;border-radius:10px;background:rgba(74,79,66,0.1);color:#4a4f42;}
      .cp-sb-close{background:none;border:none;cursor:pointer;color:#9a9d95;font-size:14px;line-height:1;padding:2px;}
      .cp-sb-graph{flex:1;background:#d5d2c7;border-bottom:0.5px solid rgba(74,79,66,0.08);overflow:hidden;}
      .cp-sb-legend{display:flex;gap:10px;padding:5px 12px;border-bottom:0.5px solid rgba(74,79,66,0.08);}
      .cp-leg{display:flex;align-items:center;gap:3px;font-size:9px;color:#9a9d95;}
      .cp-leg-dot{width:6px;height:6px;border-radius:50%;}
      .cp-sb-list{overflow-y:auto;padding:8px;}
      .cp-node-row{display:flex;align-items:flex-start;gap:5px;padding:5px 6px;border-radius:5px;margin-bottom:3px;background:#d5d2c7;border:0.5px solid rgba(74,79,66,0.1);cursor:default;}
      .cp-node-row.active{border-color:#4a4f42;background:rgba(74,79,66,0.12);}
      .cp-node-dot{width:7px;height:7px;border-radius:50%;margin-top:3px;flex-shrink:0;}
      .cp-node-body{flex:1;overflow:hidden;}
      .cp-node-title{font-size:10px;font-weight:500;color:#4a4f42;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .cp-node-meta{font-size:9px;color:#9a9d95;margin-top:1px;}
      .cp-node-tok{font-size:9px;color:#9a9d95;white-space:nowrap;}
      .cp-cmd-msg{margin:6px 0;padding:8px 12px;background:rgba(74,79,66,0.05);border-left:2.5px solid #4a4f42;border-radius:0 5px 5px 0;font-size:11px;font-family:monospace;white-space:pre;color:#6b6e63;}
    `
    document.head.appendChild(s)
  }

  private setText(id: string, val: string): void {
    const el = document.getElementById(id)
    if (el) el.textContent = val
  }

  private setBar(id: string, pct: number): void {
    const el = document.getElementById(id) as HTMLElement | null
    if (el) el.style.width = Math.min(100, pct) + '%'
  }

  update(data: {
    tokenCount?: number
    sessionUsage?: number | null
    weeklyUsage?: number | null
    cacheExpiresAt?: number | null
    tokensSaved?: number
    qualityGrade?: QualityGrade
  }): void {
    if (data.tokenCount    !== undefined) this.tokenCount    = data.tokenCount
    if (data.sessionUsage  !== undefined) this.sessionUsage  = data.sessionUsage
    if (data.weeklyUsage   !== undefined) this.weeklyUsage   = data.weeklyUsage
    if (data.cacheExpiresAt !== undefined) this.cacheExpiresAt = data.cacheExpiresAt
    if (data.tokensSaved   !== undefined) this.tokensSaved   = data.tokensSaved
    if (data.qualityGrade  !== undefined) this.qualityGrade  = data.qualityGrade
    this.refresh()
  }

  refresh(): void {
    if (!this.el) return
    const K   = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n || 0)
    const pct = (n: number | null) => n != null ? Math.round(n * 100) + '%' : '—'
    const msLeft = (t: number) => {
      const rem = t - Date.now()
      if (rem <= 0) return 'expired'
      const m = Math.floor(rem / 60000), s = Math.floor((rem % 60000) / 1000)
      return m > 0 ? `${m}m ${s}s` : `${s}s`
    }

    this.setText('cp-tokens',  K(this.tokenCount))
    this.setBar ('cp-bar-tok', Math.min(100, Math.round(this.tokenCount / 200000 * 100)))
    this.setText('cp-session', pct(this.sessionUsage))
    this.setBar ('cp-bar-ses', this.sessionUsage ? Math.round(this.sessionUsage * 100) : 0)
    this.setText('cp-weekly',  pct(this.weeklyUsage))
    this.setBar ('cp-bar-wk',  this.weeklyUsage ? Math.round(this.weeklyUsage * 100) : 0)
    this.setText('cp-cache',   this.cacheExpiresAt ? msLeft(this.cacheExpiresAt) : '—')
    this.setText('cp-saved',   this.tokensSaved > 0 ? '↓' + K(this.tokensSaved) : '—')

    const qEl = document.getElementById('cp-quality')
    if (qEl) {
      qEl.textContent = this.qualityGrade
      qEl.style.color = GRADE_COLOR[this.qualityGrade]
    }
  }

  destroy(): void {
    if (this._interval) clearInterval(this._interval)
    document.getElementById('cp-hud')?.remove()
    document.getElementById('cp-styles')?.remove()
  }
}
