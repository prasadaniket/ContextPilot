import { MessageBridge } from './MessageBridge'
import type { ConversationNode, ConversationEdge } from '../shared/types'

declare const d3: {
  select(el: Element): d3Selection
  forceSimulation(nodes: D3Node[]): d3Simulation
  forceLink(links: D3Link[]): d3Force
  forceManyBody(): d3Force
  forceCenter(x: number, y: number): d3Force
  forceCollide(): d3Force
  interpolatePurples(t: number): string
}
interface d3Selection { append(tag: string): d3Selection; attr(k: string, v: unknown): d3Selection; selectAll(s: string): d3Selection; data(d: unknown[]): d3Selection; join(t: string): d3Selection; text(fn: (d: unknown) => string): d3Selection; on(e: string, fn: (ev: Event, d: unknown) => void): d3Selection; style(k: string, v: unknown): d3Selection }
interface d3Simulation { force(n: string, f: unknown): d3Simulation; on(e: string, fn: () => void): d3Simulation }
interface d3Force { id(fn: (n: unknown) => unknown): d3Force; distance(d: number): d3Force; strength(s: number): d3Force; radius(r: number): d3Force }
interface D3Node extends ConversationNode { x: number; y: number }
interface D3Link { source: D3Node; target: D3Node }

export class TreePanel {
  private el:         HTMLElement | null = null
  private visible     = false
  private simulation: d3Simulation | null = null

  toggle(): void {
    if (!this.el) { this._create(); return }
    this.visible = !this.visible
    this.el.classList.toggle('hidden', !this.visible)
    this._adjustLayout(this.visible)
  }

  open():  void { if (!this.el) this._create(); this.visible = true;  this.el?.classList.remove('hidden'); this._adjustLayout(true) }
  close(): void { this.visible = false; this.el?.classList.add('hidden'); this._adjustLayout(false) }

  private _adjustLayout(open: boolean): void {
    const main = document.querySelector('main') || document.body
    ;(main as HTMLElement).style.paddingRight = open ? '275px' : ''
  }

  private _create(): void {
    this.el = document.createElement('div')
    this.el.id = 'cp-sidebar'
    this.el.innerHTML = `
      <div class="cp-sb-hdr">
        <span class="cp-sb-title">Context tree</span>
        <span class="cp-sb-badge" id="cp-sb-badge">0 nodes</span>
        <button class="cp-sb-close" id="cp-sb-close">×</button>
      </div>
      <div class="cp-sb-graph" id="cp-sb-graph"></div>
      <div class="cp-sb-legend">
        <div class="cp-leg"><div class="cp-leg-dot" style="background:#7F77DD;"></div>high impact</div>
        <div class="cp-leg"><div class="cp-leg-dot" style="background:#534AB7;"></div>active</div>
        <div class="cp-leg"><div class="cp-leg-dot" style="background:#BA7517;"></div>current</div>
      </div>
      <div class="cp-sb-list" id="cp-sb-list"></div>
    `
    document.body.appendChild(this.el)
    document.getElementById('cp-sb-close')!.onclick = () => this.close()
    this.visible = true
    this._adjustLayout(true)
    void this.refresh()
  }

  async refresh(activeNodeIds: string[] = []): Promise<void> {
    if (!this.el) return
    const convId = this._getConvId()
    if (!convId) return
    try {
      const data = await MessageBridge.send({ type: 'GET_GRAPH_DATA', payload: { conversationId: convId } }) as { nodes?: ConversationNode[]; edges?: ConversationEdge[] } | null
      if (!data?.nodes?.length) return
      this._renderD3(data.nodes, data.edges ?? [], new Set(activeNodeIds))
      this._renderList(data.nodes, new Set(activeNodeIds))
      const badge = document.getElementById('cp-sb-badge')
      if (badge) badge.textContent = data.nodes.length + ' nodes'
    } catch { /* non-fatal */ }
  }

  private _renderD3(nodes: ConversationNode[], edges: ConversationEdge[], activeSet: Set<string>): void {
    const container = document.getElementById('cp-sb-graph')
    if (!container || typeof d3 === 'undefined') return
    container.innerHTML = ''
    const W = container.clientWidth  || 270
    const H = container.clientHeight || 200

    const svg = d3.select(container).append('svg')
      .attr('width', '100%').attr('height', '100%')
      .attr('viewBox', `0 0 ${W} ${H}`)

    const nodeMap = new Map(nodes.map(n => [n.id, { ...n, x: W / 2, y: H / 2 } as D3Node]))
    const links: D3Link[] = edges
      .filter(e => nodeMap.has(e.source) && nodeMap.has(e.target))
      .map(e => ({ source: nodeMap.get(e.source)!, target: nodeMap.get(e.target)! }))
    const d3Nodes = Array.from(nodeMap.values())

    this.simulation = d3.forceSimulation(d3Nodes)
      .force('link',      d3.forceLink(links).id((n: unknown) => (n as D3Node).id).distance(55))
      .force('charge',    d3.forceManyBody().strength(-70))
      .force('center',    d3.forceCenter(W / 2, H / 2))
      .force('collision', d3.forceCollide().radius(18))

    // Links
    const link = svg.append('g').selectAll('line').data(links).join('line')
      .attr('stroke', (l: unknown) => {
        const d = l as D3Link
        return (activeSet.has(d.source.id) && activeSet.has(d.target.id)) ? '#534AB7' : '#AFA9EC'
      })
      .attr('stroke-width', (l: unknown) => {
        const d = l as D3Link
        return (activeSet.has(d.source.id) && activeSet.has(d.target.id)) ? 2 : 1
      })
      .attr('stroke-opacity', 0.7)

    // Nodes — sized by blastRadius, colored by purple gradient
    const node = svg.append('g').selectAll('g').data(d3Nodes).join('g').attr('cursor', 'pointer')

    node.append('circle')
      .attr('r', (d: unknown) => {
        const n = d as D3Node
        return 6 + (n.blastRadius ?? 0) * 20
      })
      .attr('fill', (d: unknown) => {
        const n = d as D3Node
        if (n.isCurrent) return '#BA7517'
        if (activeSet.has(n.id)) return '#534AB7'
        // Blast radius drives purple intensity
        return typeof d3.interpolatePurples === 'function'
          ? d3.interpolatePurples(0.3 + (n.blastRadius ?? 0) * 0.7)
          : '#1D9E75'
      })
      .attr('stroke', (d: unknown) => activeSet.has((d as D3Node).id) ? '#534AB7' : '#AFA9EC')
      .attr('stroke-width', (d: unknown) => activeSet.has((d as D3Node).id) ? 1.5 : 0.5)
      .attr('fill-opacity', (d: unknown) => {
        const n = d as D3Node
        return activeSet.size > 0 && !activeSet.has(n.id) ? 0.45 : 1
      })

    node.append('text')
      .text((d: unknown) => 'P' + (((d as D3Node).turnIndex ?? 0) + 1))
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
      .attr('font-size', '8').attr('font-weight', '600').attr('fill', 'white')
      .attr('pointer-events', 'none')

    this.simulation.on('tick', () => {
      link
        .attr('x1', (l: unknown) => Math.max(12, Math.min(W - 12, (l as D3Link).source.x)))
        .attr('y1', (l: unknown) => Math.max(12, Math.min(H - 12, (l as D3Link).source.y)))
        .attr('x2', (l: unknown) => Math.max(12, Math.min(W - 12, (l as D3Link).target.x)))
        .attr('y2', (l: unknown) => Math.max(12, Math.min(H - 12, (l as D3Link).target.y)))
      node.attr('transform', (d: unknown) => {
        const n = d as D3Node
        return `translate(${Math.max(12, Math.min(W - 12, n.x))},${Math.max(12, Math.min(H - 12, n.y))})`
      })
    })
  }

  private _renderList(nodes: ConversationNode[], activeSet: Set<string>): void {
    const list = document.getElementById('cp-sb-list')
    if (!list) return
    const sorted = [...nodes].sort((a, b) => {
      if (activeSet.has(a.id) && !activeSet.has(b.id)) return -1
      if (!activeSet.has(a.id) && activeSet.has(b.id)) return 1
      return (b.timestamp ?? 0) - (a.timestamp ?? 0)
    })
    list.innerHTML = sorted.map(n => {
      const active  = activeSet.has(n.id)
      const saved   = (n.rawTokenEstimate ?? 0) - (n.compressedTokenEstimate ?? 0)
      const preview = (n.compressed ?? '').slice(0, 50)
      const blast   = Math.round((n.blastRadius ?? 0) * 100)
      return `<div class="cp-node-row${active ? ' active' : ''}">
        <div class="cp-node-dot" style="background:${active ? '#534AB7' : '#1D9E75'};"></div>
        <div class="cp-node-body">
          <div class="cp-node-title">Turn ${(n.turnIndex ?? 0) + 1} · Q${n.qualityScore ?? 0} · ⊕${blast}%</div>
          <div class="cp-node-meta">${preview || 'compressed'}…</div>
          ${active ? '<div class="cp-node-meta" style="color:#534AB7;">will be injected</div>' : ''}
        </div>
        <div class="cp-node-tok">↓${saved}tk</div>
      </div>`
    }).join('')
  }

  private _getConvId(): string | null {
    const m = window.location.href.match(/\/chat\/([a-f0-9-]+)/)
    return m ? 'conv_' + m[1] : null
  }
}
