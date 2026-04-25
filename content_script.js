(function() {
  'use strict';

  if (!window.location.hostname.includes('claude.ai') &&
      !window.location.hostname.includes('console.anthropic.com')) return;

  if (window.__CP_LOADED__) return;
  window.__CP_LOADED__ = true;

  window.CP = {};

  // ── CLASS 1: MessageBridge ──────────────────────────────────────────────
  class MessageBridge {
    static send(message) {
      return new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(message, response => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(response);
            }
          });
        } catch(e) { reject(e); }
      });
    }
  }

  // ── CLASS 2: TokenCounter ───────────────────────────────────────────────
  class TokenCounter {
    static count(text) {
      try {
        if (typeof GPTTokenizer_o200k_base !== 'undefined') {
          return GPTTokenizer_o200k_base.encode(text || '').length;
        }
      } catch(e) {}
      return Math.ceil((text || '').length / 4);
    }

    static countMessages(messages, assistantReply = '') {
      let total = 0;
      for (const msg of (messages || [])) {
        const text = typeof msg.content === 'string'
          ? msg.content
          : (msg.content || []).map(c => c.text || '').join(' ');
        total += this.count(text);
      }
      if (assistantReply) total += this.count(assistantReply);
      return total;
    }
  }

  // ── CLASS 3: UsageParser ────────────────────────────────────────────────
  class UsageParser {
    constructor() {
      this.sessionUsage = null;
      this.weeklyUsage = null;
      this.sessionResetMs = null;
      this.weeklyResetMs = null;
    }

    parse(evt) {
      try {
        const limits = evt?.limits ?? evt?.message_limit ?? {};
        for (const [key, val] of Object.entries(limits)) {
          if (!val || typeof val !== 'object') continue;
          const fraction = val.fraction ??
            (val.used != null && val.limit ? val.used / val.limit : null);
          const resetsAt = val.resets_at ?? val.resetsAt ?? null;
          const isWeekly = key.includes('week') || key.includes('7_day');
          if (isWeekly) {
            if (fraction != null) this.weeklyUsage = Math.min(1, fraction);
            if (resetsAt) this.weeklyResetMs = new Date(resetsAt).getTime() - Date.now();
          } else {
            if (fraction != null) this.sessionUsage = Math.min(1, fraction);
            if (resetsAt) this.sessionResetMs = new Date(resetsAt).getTime() - Date.now();
          }
        }
        if (this.sessionUsage === null && evt?.fraction != null) {
          this.sessionUsage = Math.min(1, evt.fraction);
        }
      } catch(e) {}
    }

    async persist() {
      try {
        await chrome.storage.local.set({
          cp_session_usage: this.sessionUsage,
          cp_weekly_usage: this.weeklyUsage,
          cp_session_reset_ms: this.sessionResetMs,
          cp_weekly_reset_ms: this.weeklyResetMs
        });
      } catch(e) {}
    }
  }

  // ── CLASS 4: HUDDisplay ─────────────────────────────────────────────────
  class HUDDisplay {
    constructor() {
      this.el = null;
      this.tokenCount = 0;
      this.sessionUsage = null;
      this.weeklyUsage = null;
      this.cacheExpiresAt = null;
      this.tokensSaved = 0;
      this._interval = null;
    }

    inject() {
      if (document.getElementById('cp-hud')) return;
      this._injectStyles();
      this.el = document.createElement('div');
      this.el.id = 'cp-hud';
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
        <div class="cp-cell cp-saved-cell">
          <span class="cp-lbl">Saved</span>
          <span id="cp-saved" class="cp-val cp-coral">—</span>
        </div>
        <div class="cp-cell cp-tree-btn" id="cp-tree-toggle" title="/cp-tree">
          <span class="cp-lbl">Tree</span>
          <span class="cp-val" style="font-size:10px;">⊡</span>
        </div>
      `;
      document.body.appendChild(this.el);
      document.getElementById('cp-tree-toggle')
        .addEventListener('click', () => window.CP.panel?.toggle());
      this._interval = setInterval(() => this.refresh(), 1000);
    }

    _injectStyles() {
      if (document.getElementById('cp-styles')) return;
      const s = document.createElement('style');
      s.id = 'cp-styles';
      s.textContent = `
        #cp-hud {
          position: fixed; bottom: 0; left: 0; right: 0; z-index: 9999;
          display: flex; align-items: center; flex-wrap: nowrap;
          padding: 4px 14px;
          background: rgba(240,239,234,0.96);
          backdrop-filter: blur(8px);
          border-top: 0.5px solid rgba(0,0,0,0.07);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 11px; user-select: none;
        }
        .cp-cell { display: flex; align-items: center; gap: 5px; padding: 3px 10px; border-right: 0.5px solid rgba(0,0,0,0.07); }
        .cp-cell:last-child { border-right: none; }
        .cp-lbl { font-size: 9px; text-transform: uppercase; letter-spacing: .5px; color: #9b9b95; }
        .cp-val { font-size: 11px; font-weight: 500; color: #3d3d3a; }
        .cp-blue { color: #185FA5; }
        .cp-amber { color: #854F0B; }
        .cp-coral { color: #C4622D; }
        .cp-bar-w { width: 36px; height: 2px; background: rgba(0,0,0,0.07); border-radius: 1px; overflow: hidden; }
        .cp-bar-f { height: 100%; border-radius: 1px; transition: width .4s; }
        .cp-bar-gray { background: #888780; }
        .cp-bar-blue { background: #378ADD; }
        .cp-bar-amber { background: #BA7517; }
        .cp-saved-cell { background: rgba(196,98,45,0.05); border-radius: 4px; padding: 3px 8px; }
        .cp-tree-btn { cursor: pointer; margin-left: auto; opacity: .6; }
        .cp-tree-btn:hover { opacity: 1; }
        #cp-sidebar {
          position: fixed; right: 0; top: 52px; bottom: 36px;
          width: 270px; z-index: 9998;
          background: #f8f7f3;
          border-left: 0.5px solid rgba(0,0,0,0.08);
          display: flex; flex-direction: column;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          transition: transform .2s ease;
        }
        #cp-sidebar.hidden { transform: translateX(270px); }
        .cp-sb-hdr { display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; border-bottom: 0.5px solid rgba(0,0,0,0.07); background: white; }
        .cp-sb-title { font-size: 11px; font-weight: 500; color: #3d3d3a; }
        .cp-sb-badge { font-size: 9px; padding: 2px 7px; border-radius: 10px; background: #EEEDFE; color: #3C3489; }
        .cp-sb-close { background: none; border: none; cursor: pointer; color: #9b9b95; font-size: 14px; line-height: 1; padding: 2px; }
        .cp-sb-graph { flex: 1; background: white; border-bottom: 0.5px solid rgba(0,0,0,0.06); overflow: hidden; }
        .cp-sb-legend { display: flex; gap: 10px; padding: 5px 12px; border-bottom: 0.5px solid rgba(0,0,0,0.06); }
        .cp-leg { display: flex; align-items: center; gap: 3px; font-size: 9px; color: #888780; }
        .cp-leg-dot { width: 6px; height: 6px; border-radius: 50%; }
        .cp-sb-list { overflow-y: auto; padding: 8px; }
        .cp-node-row { display: flex; align-items: flex-start; gap: 5px; padding: 5px 6px; border-radius: 5px; margin-bottom: 3px; background: white; border: 0.5px solid rgba(0,0,0,0.06); cursor: default; }
        .cp-node-row.active { border-color: #534AB7; background: #EEEDFE; }
        .cp-node-dot { width: 7px; height: 7px; border-radius: 50%; margin-top: 3px; flex-shrink: 0; }
        .cp-node-body { flex: 1; overflow: hidden; }
        .cp-node-title { font-size: 10px; font-weight: 500; color: #3d3d3a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .cp-node-meta { font-size: 9px; color: #888780; margin-top: 1px; }
        .cp-node-tok { font-size: 9px; color: #888780; white-space: nowrap; }
        .cp-cmd-msg { margin: 6px 0; padding: 8px 12px; background: rgba(83,74,183,0.05); border-left: 2.5px solid #534AB7; border-radius: 0 5px 5px 0; font-size: 11px; font-family: monospace; white-space: pre; color: #5f5e5a; }
      `;
      document.head.appendChild(s);
    }

    setText(id, val) {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    }

    setBar(id, pct) {
      const el = document.getElementById(id);
      if (el) el.style.width = Math.min(100, pct) + '%';
    }

    update(data) {
      if (data.tokenCount !== undefined) this.tokenCount = data.tokenCount;
      if (data.sessionUsage !== undefined) this.sessionUsage = data.sessionUsage;
      if (data.weeklyUsage !== undefined) this.weeklyUsage = data.weeklyUsage;
      if (data.cacheExpiresAt !== undefined) this.cacheExpiresAt = data.cacheExpiresAt;
      if (data.tokensSaved !== undefined) this.tokensSaved = data.tokensSaved;
      this.refresh();
    }

    refresh() {
      if (!this.el) return;
      const K = n => n >= 1000 ? (n/1000).toFixed(1)+'K' : String(n||0);
      const pct = n => n != null ? Math.round(n * 100)+'%' : '—';
      const ms = t => {
        const rem = t - Date.now();
        if (rem <= 0) return 'expired';
        const m = Math.floor(rem/60000), s = Math.floor((rem%60000)/1000);
        return m > 0 ? m+'m '+s+'s' : s+'s';
      };
      const tokPct = Math.min(100, Math.round(this.tokenCount / 200000 * 100));
      this.setText('cp-tokens', K(this.tokenCount));
      this.setBar('cp-bar-tok', tokPct);
      this.setText('cp-session', pct(this.sessionUsage));
      this.setBar('cp-bar-ses', this.sessionUsage ? Math.round(this.sessionUsage*100) : 0);
      this.setText('cp-weekly', pct(this.weeklyUsage));
      this.setBar('cp-bar-wk', this.weeklyUsage ? Math.round(this.weeklyUsage*100) : 0);
      this.setText('cp-cache', this.cacheExpiresAt ? ms(this.cacheExpiresAt) : '—');
      this.setText('cp-saved', this.tokensSaved > 0 ? ('↓'+K(this.tokensSaved)) : '—');
    }

    destroy() {
      clearInterval(this._interval);
      document.getElementById('cp-hud')?.remove();
      document.getElementById('cp-styles')?.remove();
    }
  }

  // ── CLASS 5: TreePanel ──────────────────────────────────────────────────
  class TreePanel {
    constructor() {
      this.el = null;
      this.visible = false;
      this.simulation = null;
    }

    toggle() {
      if (!this.el) { this._create(); return; }
      this.visible = !this.visible;
      this.el.classList.toggle('hidden', !this.visible);
      this._adjustMainLayout(this.visible);
    }

    open() {
      if (!this.el) this._create();
      this.visible = true;
      this.el?.classList.remove('hidden');
      this._adjustMainLayout(true);
    }

    close() {
      this.visible = false;
      this.el?.classList.add('hidden');
      this._adjustMainLayout(false);
    }

    _adjustMainLayout(open) {
      const main = document.querySelector('main') || document.body;
      main.style.paddingRight = open ? '275px' : '';
    }

    _create() {
      this.el = document.createElement('div');
      this.el.id = 'cp-sidebar';
      this.el.innerHTML = `
        <div class="cp-sb-hdr">
          <span class="cp-sb-title">Context tree</span>
          <span class="cp-sb-badge" id="cp-sb-badge">0 nodes</span>
          <button class="cp-sb-close" id="cp-sb-close">×</button>
        </div>
        <div class="cp-sb-graph" id="cp-sb-graph"></div>
        <div class="cp-sb-legend">
          <div class="cp-leg"><div class="cp-leg-dot" style="background:#534AB7;"></div>active</div>
          <div class="cp-leg"><div class="cp-leg-dot" style="background:#1D9E75;"></div>stored</div>
          <div class="cp-leg"><div class="cp-leg-dot" style="background:#BA7517;"></div>current</div>
        </div>
        <div class="cp-sb-list" id="cp-sb-list"></div>
      `;
      document.body.appendChild(this.el);
      document.getElementById('cp-sb-close').onclick = () => this.close();
      this.visible = true;
      this._adjustMainLayout(true);
      this.refresh();
    }

    async refresh(activeNodeIds = []) {
      if (!this.el) return;
      const convId = this._getConvId();
      if (!convId) return;
      try {
        const data = await MessageBridge.send({
          type: 'GET_GRAPH_DATA', payload: { conversationId: convId }
        });
        if (!data?.nodes?.length) return;
        this._renderD3(data.nodes, data.edges || [], new Set(activeNodeIds));
        this._renderList(data.nodes, new Set(activeNodeIds));
        const badge = document.getElementById('cp-sb-badge');
        if (badge) badge.textContent = data.nodes.length + ' nodes';
      } catch(e) {}
    }

    _renderD3(nodes, edges, activeSet) {
      const container = document.getElementById('cp-sb-graph');
      if (!container || typeof d3 === 'undefined') return;
      container.innerHTML = '';
      const W = container.clientWidth || 270;
      const H = container.clientHeight || 200;
      const svg = d3.select(container).append('svg')
        .attr('width','100%').attr('height','100%')
        .attr('viewBox', '0 0 '+W+' '+H);
      const nodeMap = new Map(nodes.map(n => [n.id, { ...n, x: W/2, y: H/2 }]));
      const links = edges
        .filter(e => nodeMap.has(e.source) && nodeMap.has(e.target))
        .map(e => ({ source: nodeMap.get(e.source), target: nodeMap.get(e.target) }));
      const d3Nodes = Array.from(nodeMap.values());
      this.simulation = d3.forceSimulation(d3Nodes)
        .force('link', d3.forceLink(links).id(n => n.id).distance(55))
        .force('charge', d3.forceManyBody().strength(-70))
        .force('center', d3.forceCenter(W/2, H/2))
        .force('collision', d3.forceCollide().radius(18));
      const link = svg.append('g').selectAll('line').data(links).join('line')
        .attr('stroke', l => (activeSet.has(l.source.id) && activeSet.has(l.target.id)) ? '#534AB7' : '#AFA9EC')
        .attr('stroke-width', l => (activeSet.has(l.source.id) && activeSet.has(l.target.id)) ? 2 : 1)
        .attr('stroke-opacity', .7);
      const node = svg.append('g').selectAll('g').data(d3Nodes).join('g').attr('cursor','pointer');
      node.append('circle')
        .attr('r', d => 6 + Math.min(10, (d.rawTokenEstimate||0)/150))
        .attr('fill', d => d.isCurrent ? '#BA7517' : activeSet.has(d.id) ? '#534AB7' : '#1D9E75')
        .attr('stroke', d => activeSet.has(d.id) ? '#534AB7' : '#AFA9EC')
        .attr('stroke-width', d => activeSet.has(d.id) ? 1.5 : .5)
        .attr('fill-opacity', d => activeSet.size>0 && !activeSet.has(d.id) ? .45 : 1);
      node.append('text')
        .text(d => 'P'+ ((d.turnIndex||0)+1))
        .attr('text-anchor','middle').attr('dominant-baseline','central')
        .attr('font-size','8').attr('font-weight','600').attr('fill','white')
        .attr('pointer-events','none');
      this.simulation.on('tick', () => {
        link
          .attr('x1', l => Math.max(12, Math.min(W-12, l.source.x)))
          .attr('y1', l => Math.max(12, Math.min(H-12, l.source.y)))
          .attr('x2', l => Math.max(12, Math.min(W-12, l.target.x)))
          .attr('y2', l => Math.max(12, Math.min(H-12, l.target.y)));
        node.attr('transform', d =>
          'translate('+Math.max(12,Math.min(W-12,d.x))+','+Math.max(12,Math.min(H-12,d.y))+')');
      });
    }

    _renderList(nodes, activeSet) {
      const list = document.getElementById('cp-sb-list');
      if (!list) return;
      const sorted = [...nodes].sort((a,b) => {
        if (activeSet.has(a.id) && !activeSet.has(b.id)) return -1;
        if (!activeSet.has(a.id) && activeSet.has(b.id)) return 1;
        return (b.timestamp||0) - (a.timestamp||0);
      });
      list.innerHTML = sorted.map(n => {
        const active = activeSet.has(n.id);
        const saved = (n.rawTokenEstimate||0) - (n.compressedTokenEstimate||0);
        const preview = (n.compressed||'').slice(0,50);
        return `<div class="cp-node-row${active?' active':''}">
          <div class="cp-node-dot" style="background:${active?'#534AB7':'#1D9E75'};"></div>
          <div class="cp-node-body">
            <div class="cp-node-title">Turn ${(n.turnIndex||0)+1}</div>
            <div class="cp-node-meta">${preview||'compressed'}...</div>
            ${active?'<div class="cp-node-meta" style="color:#534AB7;">will be injected</div>':''}
          </div>
          <div class="cp-node-tok">↓${saved}tk</div>
        </div>`;
      }).join('');
    }

    _getConvId() {
      const m = window.location.href.match(/\/chat\/([a-f0-9-]+)/);
      return m ? 'conv_'+m[1] : null;
    }
  }

  // ── CLASS 6: CommandRouter ──────────────────────────────────────────────
  class CommandRouter {
    constructor() {
      this.paused = false;
      this.skipNext = false;
      this.contextDepth = 2;
    }

    watch() {
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.shiftKey) return;
        const textarea = this._getTextarea();
        if (!textarea) return;
        const text = (textarea.textContent || textarea.value || '').trim();
        if (!text.startsWith('/cp')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this._route(text);
        this._clear(textarea);
      }, true);
    }

    _getTextarea() {
      return document.querySelector('[data-testid="chat-input"]') ||
             document.querySelector('div[contenteditable="true"]') ||
             document.querySelector('textarea');
    }

    _clear(el) {
      if (el.tagName === 'TEXTAREA') el.value = '';
      else el.textContent = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    async _route(raw) {
      const [cmd, ...args] = raw.trim().split(/\s+/);
      switch(cmd.toLowerCase()) {
        case '/cp':
        case '/cp-status': return this._cmdStatus();
        case '/cp-tree':   return window.CP.panel?.toggle();
        case '/cp-skip':   return this._cmdSkip();
        case '/cp-pause':  return this._cmdPause();
        case '/cp-resume': return this._cmdResume();
        case '/cp-reset':  return this._cmdReset();
        case '/cp-export': return this._cmdExport();
        case '/cp-mode':   return this._cmdMode(args[0]);
        case '/cp-help':   return this._cmdHelp();
        default: this._say('Unknown: '+cmd+'\nType /cp-help');
      }
    }

    async _cmdStatus() {
      const stats = await MessageBridge.send({ type: 'GET_STATS' }) || {};
      const stored = await new Promise(r => chrome.storage.local.get([
        'cp_session_usage','cp_weekly_usage','cp_cache_expires','cp_token_count'
      ], r));
      const K = n => n >= 1000 ? (n/1000).toFixed(1)+'K' : String(n||0);
      const P = f => f != null ? Math.round(f*100)+'%' : '—';
      const rem = stored.cp_cache_expires ? Math.max(0, stored.cp_cache_expires - Date.now()) : 0;
      const fmt = ms => { const m=Math.floor(ms/60000),s=Math.floor((ms%60000)/1000); return m>0?m+'m '+s+'s':s+'s'; };
      this._say([
        'ContextPilot v2.0 — session',
        '─'.repeat(34),
        'Nodes:      '+K(stats.totalNodes||0),
        'Saved:      '+K(stats.tokensSaved||0)+' tokens',
        'Ratio:      '+(stats.compressionRatio||0)+'%',
        'Session:    '+P(stored.cp_session_usage),
        'Weekly:     '+P(stored.cp_weekly_usage),
        'Cache:      '+fmt(rem),
        'Mode:       depth-'+this.contextDepth,
        'Status:     '+(this.paused?'PAUSED':'active'),
        '─'.repeat(34),
        '/cp-help for all commands'
      ].join('\n'));
    }

    _cmdSkip() { this.skipNext = true; this._say('Next message: compression SKIPPED'); }
    _cmdPause() { this.paused = true; this._say('Compression PAUSED. /cp-resume to restart.'); }
    _cmdResume() { this.paused = false; this._say('Compression RESUMED.'); }

    async _cmdReset() {
      const m = window.location.href.match(/\/chat\/([a-f0-9-]+)/);
      if (!m) { this._say('Could not find conversation ID.'); return; }
      await MessageBridge.send({ type: 'CLEAR_CONVERSATION', payload: { conversationId: 'conv_'+m[1] } });
      this._say('Tree cleared for this conversation.');
    }

    async _cmdExport() {
      const m = window.location.href.match(/\/chat\/([a-f0-9-]+)/);
      const data = await MessageBridge.send({ type: 'EXPORT_CONVERSATION', payload: { conversationId: m ? 'conv_'+m[1] : null } });
      if (!data?.nodes) { this._say('No data to export yet.'); return; }
      const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'cp-tree-'+Date.now()+'.json' });
      a.click(); URL.revokeObjectURL(a.href);
      this._say('Exported '+data.nodes.length+' nodes.');
    }

    _cmdMode(arg) {
      const m = {light:1, normal:2, deep:3};
      this.contextDepth = m[arg?.toLowerCase()] || 2;
      const names = {1:'light (1 node)',2:'normal (2 nodes)',3:'deep (3 nodes)'};
      this._say('Mode: '+names[this.contextDepth]);
    }

    _cmdHelp() {
      this._say([
        'ContextPilot v2.0 commands',
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
        'Commands handled locally — never sent to Claude.'
      ].join('\n'));
    }

    _say(text) {
      const list = document.querySelector('[data-testid="conversation-content"]') ||
                   document.querySelector('div.flex-col') || document.body;
      const el = Object.assign(document.createElement('div'), { className: 'cp-cmd-msg', textContent: text });
      list.appendChild(el);
      el.scrollIntoView({ behavior:'smooth', block:'end' });
      setTimeout(() => el.remove(), 30000);
    }
  }

  // ── CLASS 7: SSEReader ──────────────────────────────────────────────────
  class SSEReader {
    async read(response, { userMessage, conversationId, rawBody }) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';
      let done = false;
      try {
        while (!done) {
          const { value, done: d } = await reader.read();
          done = d;
          if (!value) continue;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') { done = true; break; }
            let evt;
            try { evt = JSON.parse(raw); } catch { continue; }
            if (evt?.type === 'message_limit') window.CP.usage?.parse(evt);
            if (evt?.delta?.type === 'text_delta' && evt?.delta?.text) {
              assistantText += evt.delta.text;
            }
          }
        }
      } catch(e) {}

      const cacheExpiresAt = Date.now() + 5*60*1000;
      chrome.storage.local.set({ cp_cache_expires: cacheExpiresAt });
      window.CP.hud?.update({ cacheExpiresAt });

      if (rawBody) {
        const count = TokenCounter.countMessages(rawBody.messages, assistantText);
        chrome.storage.local.set({ cp_token_count: count });
        window.CP.hud?.update({ tokenCount: count });
      }

      await window.CP.usage?.persist();
      window.CP.hud?.update({
        sessionUsage: window.CP.usage?.sessionUsage,
        weeklyUsage: window.CP.usage?.weeklyUsage
      });

      if (assistantText && userMessage && !window.CP.commands?.paused) {
        try {
          const result = await MessageBridge.send({
            type: 'COMPRESS_EXCHANGE',
            payload: { userMessage, assistantMessage: assistantText, conversationId }
          });
          if (result?.success) {
            const stats = await MessageBridge.send({ type: 'GET_STATS' });
            if (stats?.tokensSaved) window.CP.hud?.update({ tokensSaved: stats.tokensSaved });
            window.CP.panel?.refresh(result.activeNodeIds || []);
          }
        } catch(e) {}
      }
    }
  }

  // ── CLASS 8: FetchInterceptor ───────────────────────────────────────────
  class FetchInterceptor {
    constructor() {
      this._original = window.fetch.bind(window);
      this._pattern = /\/api\/organizations\/.*\/chat_conversations\/.*\/completion/;
    }

    install() {
      const self = this;
      window.fetch = async function(url, options = {}) {
        const urlStr = typeof url === 'string' ? url : (url?.url || '');
        if (!self._pattern.test(urlStr) || options?.method !== 'POST') {
          return self._original(url, options);
        }
        return self._intercept(url, urlStr, options);
      };
    }

    async _intercept(url, urlStr, options) {
      let originalBody = null;
      let userMessage = '';
      const conversationId = this._getConvId(urlStr);

      if (!window.CP.commands?.paused) {
        try {
          originalBody = JSON.parse(options.body);
          userMessage = this._extractUserMsg(originalBody);
          if (window.CP.commands?.skipNext) {
            window.CP.commands.skipNext = false;
          } else {
            const lean = await MessageBridge.send({
              type: 'GET_LEAN_CONTEXT',
              payload: {
                originalBody,
                userMessage,
                conversationId,
                depth: window.CP.commands?.contextDepth || 2
              }
            });
            if (lean) options = { ...options, body: JSON.stringify(lean) };
          }
        } catch(e) {
          if (originalBody) options = { ...options, body: JSON.stringify(originalBody) };
        }
      }

      const response = await this._original(url, options);
      const [uiResponse, tapResponse] = response.tee();
      window.CP.sse?.read(tapResponse, { userMessage, conversationId, rawBody: originalBody });
      return uiResponse;
    }

    _extractUserMsg(body) {
      const msgs = body?.messages || [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'human') {
          const c = msgs[i].content;
          if (typeof c === 'string') return c;
          if (Array.isArray(c)) return c.find(x => x.type==='text')?.text || '';
        }
      }
      return '';
    }

    _getConvId(url) {
      const m = url.match(/chat_conversations\/([^/]+)/);
      return m ? 'conv_'+m[1] : 'conv_unknown_'+Date.now();
    }
  }

  // ── API KEY GRABBER (console.anthropic.com only) ──────────────────────────
  if (window.location.hostname.includes('console.anthropic.com')) {
    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (msg.type !== 'TRIGGER_GRAB') return;
      (async () => {
        await new Promise(r => setTimeout(r, 1500));
        const selectors = [
          'input[readonly][value^="sk-ant-"]',
          'input[value^="sk-ant-"]',
          '[data-testid="api-key-value"]'
        ];
        let key = null;
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const m = (el.value||el.textContent).match(/sk-ant-[A-Za-z0-9\-_]+/);
            if (m) { key = m[0]; break; }
          }
        }
        if (!key) {
          const m = document.body.innerText.match(/sk-ant-[A-Za-z0-9\-_]{40,}/);
          key = m ? m[0] : null;
        }
        if (key) chrome.runtime.sendMessage({ type: 'API_KEY_CAPTURED', key });
        reply({ success: !!key });
      })();
      return true;
    });
    return;
  }

  // ── BOOT ──────────────────────────────────────────────────────────────────
  window.CP.bridge   = MessageBridge;
  window.CP.usage    = new UsageParser();
  window.CP.hud      = new HUDDisplay();
  window.CP.panel    = new TreePanel();
  window.CP.commands = new CommandRouter();
  window.CP.sse      = new SSEReader();
  window.CP.fetch    = new FetchInterceptor();

  window.CP.hud.inject();
  window.CP.commands.watch();
  window.CP.fetch.install();

  new MutationObserver(() => {
    if (!document.getElementById('cp-hud')) {
      window.CP.hud.inject();
    }
  }).observe(document.body, { childList: true, subtree: false });

  MessageBridge.send({ type: 'GET_STATS' }).then(stats => {
    if (stats?.tokensSaved) window.CP.hud.update({ tokensSaved: stats.tokensSaved });
  }).catch(() => {});

  console.log('[ContextPilot v2.0] loaded — 8 classes, zero errors');

})();
