/**
 * ContextPilot v1.0 — tree_panel.js
 * --------------------------------
 * D3.js sidebar panel (code-review-graph pattern).
 *
 * Sources:
 *   Display layer adapted from claude-counter by she-llac (MIT)
 *   https://github.com/she-llac/claude-counter
 *
 *   Command pattern adapted from get-shit-done by gsd-build (MIT)
 *   https://github.com/gsd-build/get-shit-done
 *
 *   Graph visualization adapted from code-review-graph by tirth8205 (MIT)
 *   https://github.com/tirth8205/code-review-graph
 *
 * GitHub: https://github.com/prasadaniket/ContextPilot
 */
const LOG = '[ContextPilot Graph]';
const D3_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js';

const COLORS = {
  active:   '#534AB7',  // purple — in the active relevance path
  stored:   '#1D9E75',  // teal   — stored node, not active
  current:  '#BA7517',  // amber  — the prompt being typed right now
  inactive: '#888780',  // gray   — old, low-relevance nodes
  edge:     '#AFA9EC',  // light purple — normal edges
  edgeActive: '#534AB7' // purple — active path edges
};

let d3 = null;      // will be loaded from CDN
let simulation = null;
let panelEl = null;
let svgEl = null;
let currentNodes = [];
let currentEdges = [];

// ── Panel Lifecycle ───────────────────────────────────────────────────────────

/**
 * openPanel
 * ---------
 * Creates and injects the sidebar panel into claude.ai.
 * Loads D3 from CDN if not already loaded.
 */
export async function openPanel() {
  if (document.getElementById('cp-sidebar')) {
    document.getElementById('cp-sidebar').style.display = 'flex';
    adjustMainLayout(true);
    return;
  }

  // Load D3 from CDN
  d3 = await loadD3();

  // Inject the panel
  createPanel();
  adjustMainLayout(true);

  // Load initial data
  await refreshGraph();

  console.log(`${LOG} Panel opened`);
}

/**
 * closePanel
 * ----------
 * Hides the panel and restores the main layout.
 */
export function closePanel() {
  const panel = document.getElementById('cp-sidebar');
  if (panel) panel.style.display = 'none';
  adjustMainLayout(false);
}

/**
 * togglePanel
 * -----------
 * Opens or closes the panel.
 */
export function togglePanel() {
  const panel = document.getElementById('cp-sidebar');
  if (!panel || panel.style.display === 'none') {
    openPanel();
  } else {
    closePanel();
  }
}

// ── Panel DOM ─────────────────────────────────────────────────────────────────

/**
 * createPanel
 * -----------
 * Builds the sidebar DOM and injects it into document.body.
 */
function createPanel() {
  const style = document.createElement('style');
  style.textContent = `
    #cp-sidebar {
      position: fixed; right: 0; top: 60px;
      width: 280px; height: calc(100vh - 120px);
      background: var(--color-background-secondary, #f6f5f2);
      border-left: 0.5px solid rgba(0,0,0,0.1);
      display: flex; flex-direction: column;
      z-index: 9998;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      #cp-sidebar { background: #1c1c1a; border-color: rgba(255,255,255,0.1); }
    }
    .cp-sb-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 12px;
      border-bottom: 0.5px solid rgba(0,0,0,0.1);
      background: var(--color-background-primary, white);
    }
    .cp-sb-title { font-size: 12px; font-weight: 600; color: var(--color-text-primary, #1a1a1a); }
    .cp-sb-badge {
      font-size: 10px; padding: 2px 7px; border-radius: 20px;
      background: #EEEDFE; color: #3C3489; font-weight: 500;
    }
    .cp-sb-close {
      width: 20px; height: 20px; border-radius: 50%;
      background: none; border: none; cursor: pointer;
      color: var(--color-text-secondary, #666); font-size: 14px;
      display: flex; align-items: center; justify-content: center;
    }
    .cp-sb-close:hover { background: rgba(0,0,0,0.06); }
    #cp-d3-area { flex: 1; overflow: hidden; }
    .cp-sb-legend {
      display: flex; gap: 10px; padding: 6px 12px;
      border-top: 0.5px solid rgba(0,0,0,0.07);
      border-bottom: 0.5px solid rgba(0,0,0,0.07);
    }
    .cp-leg { display: flex; align-items: center; gap: 3px; font-size: 9px; color: var(--color-text-secondary, #666); }
    .cp-dot { width: 7px; height: 7px; border-radius: 50%; }
    #cp-node-list { overflow-y: auto; padding: 8px; max-height: 180px; }
    .cp-node-item {
      display: flex; align-items: flex-start; gap: 6px;
      padding: 5px 6px; border-radius: 5px; margin-bottom: 4px;
      background: var(--color-background-primary, white);
      border: 0.5px solid rgba(0,0,0,0.07);
      cursor: pointer;
    }
    .cp-node-item:hover { border-color: #534AB7; }
    .cp-node-item.cp-active { border-color: #534AB7; background: #EEEDFE; }
    @media (prefers-color-scheme: dark) { .cp-node-item.cp-active { background: #26215C; } }
    .cp-node-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 3px; flex-shrink: 0; }
    .cp-node-body { flex: 1; overflow: hidden; }
    .cp-node-title { font-size: 10px; font-weight: 500; color: var(--color-text-primary, #1a1a1a); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cp-node-meta { font-size: 9px; color: var(--color-text-secondary, #666); margin-top: 1px; }
    .cp-node-tok { font-size: 9px; color: var(--color-text-secondary, #666); white-space: nowrap; flex-shrink: 0; }
    .cp-tooltip {
      position: absolute; pointer-events: none;
      background: var(--color-background-primary, white);
      border: 0.5px solid rgba(0,0,0,0.12);
      border-radius: 6px; padding: 6px 8px;
      font-size: 10px; max-width: 200px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      display: none; z-index: 10000;
    }
  `;
  document.head.appendChild(style);

  panelEl = document.createElement('div');
  panelEl.id = 'cp-sidebar';
  panelEl.innerHTML = `
    <div class="cp-sb-header">
      <span class="cp-sb-title">Context tree</span>
      <span class="cp-sb-badge" id="cp-sb-badge">0 nodes</span>
      <button class="cp-sb-close" id="cp-sb-close" title="Close">×</button>
    </div>
    <div id="cp-d3-area"></div>
    <div class="cp-sb-legend">
      <div class="cp-leg"><div class="cp-dot" style="background:#534AB7"></div>active path</div>
      <div class="cp-leg"><div class="cp-dot" style="background:#1D9E75"></div>stored</div>
      <div class="cp-leg"><div class="cp-dot" style="background:#BA7517"></div>current</div>
    </div>
    <div id="cp-node-list"></div>
    <div class="cp-tooltip" id="cp-tooltip"></div>
  `;

  document.body.appendChild(panelEl);

  document.getElementById('cp-sb-close').onclick = closePanel;
}

// ── D3 Graph ──────────────────────────────────────────────────────────────────

/**
 * refreshGraph
 * ------------
 * Fetches the latest nodes from background.js and re-renders the D3 graph.
 * Called after each compression completes.
 */
export async function refreshGraph(activeNodeIds = []) {
  const convId = getCurrentConversationId();
  if (!convId || !d3) return;

  const data = await sendToBg({ type: 'GET_GRAPH_DATA', payload: { conversationId: convId } });
  if (!data?.nodes) return;

  currentNodes = data.nodes;
  currentEdges = data.edges || buildEdgesFromNodes(data.nodes);

  renderD3Graph(currentNodes, currentEdges, new Set(activeNodeIds));
  renderNodeList(currentNodes, new Set(activeNodeIds));
  updateBadge(currentNodes.length);
}

/**
 * renderD3Graph
 * -------------
 * Renders the D3 force-directed graph.
 * Adapted from code-review-graph's D3 force simulation approach.
 *
 * @param {object[]} nodes
 * @param {object[]} edges
 * @param {Set}      activeSet - node IDs in the active relevance path
 */
function renderD3Graph(nodes, edges, activeSet) {
  const container = document.getElementById('cp-d3-area');
  if (!container || !d3) return;

  const W = container.clientWidth || 280;
  const H = container.clientHeight || 200;

  container.innerHTML = '';

  const svg = d3.select(container)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `0 0 ${W} ${H}`);

  svgEl = svg;

  // Build D3 node/link data
  const nodeMap = new Map(nodes.map(n => [n.id, { ...n, x: W/2, y: H/2 }]));
  const links = edges
    .filter(e => nodeMap.has(e.source) && nodeMap.has(e.target))
    .map(e => ({ source: nodeMap.get(e.source), target: nodeMap.get(e.target), ...e }));
  const d3Nodes = Array.from(nodeMap.values());

  // Force simulation
  simulation = d3.forceSimulation(d3Nodes)
    .force('link', d3.forceLink(links).id(n => n.id).distance(60))
    .force('charge', d3.forceManyBody().strength(-80))
    .force('center', d3.forceCenter(W/2, H/2))
    .force('collision', d3.forceCollide().radius(20));

  // Edges
  const link = svg.append('g').selectAll('line').data(links).join('line')
    .attr('stroke', l => activeSet.has(l.source.id) && activeSet.has(l.target.id)
      ? COLORS.edgeActive : COLORS.edge)
    .attr('stroke-width', l => activeSet.has(l.source.id) && activeSet.has(l.target.id) ? 2 : 1)
    .attr('stroke-opacity', 0.7);

  // Nodes
  const tooltip = document.getElementById('cp-tooltip');

  const node = svg.append('g').selectAll('g').data(d3Nodes).join('g')
    .attr('cursor', 'pointer')
    .on('mouseover', (event, d) => {
      if (!tooltip) return;
      tooltip.innerHTML = `
        <div style="font-weight:600;margin-bottom:3px">${d.id.slice(-8)}</div>
        <div>${(d.compressed || '').slice(0, 80)}...</div>
        <div style="color:#534AB7;margin-top:3px">
          ${d.rawTokenEstimate}→${d.compressedTokenEstimate} tok
        </div>`;
      tooltip.style.display = 'block';
      tooltip.style.left = (event.clientX - container.getBoundingClientRect().left + 8) + 'px';
      tooltip.style.top = (event.clientY - container.getBoundingClientRect().top - 20) + 'px';
    })
    .on('mouseout', () => { if (tooltip) tooltip.style.display = 'none'; });

  // Node circles
  node.append('circle')
    .attr('r', d => 6 + Math.min(10, (d.rawTokenEstimate || 0) / 150))
    .attr('fill', d => {
      if (d.isCurrent) return COLORS.current;
      if (activeSet.has(d.id)) return COLORS.active;
      return COLORS.stored;
    })
    .attr('stroke', d => activeSet.has(d.id) ? COLORS.active : COLORS.edge)
    .attr('stroke-width', d => activeSet.has(d.id) ? 1.5 : 0.5)
    .attr('fill-opacity', d => activeSet.size > 0 && !activeSet.has(d.id) ? 0.4 : 1);

  // Node labels
  node.append('text')
    .text(d => `P${(d.turnIndex ?? 0) + 1}`)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('font-size', '8')
    .attr('font-weight', '600')
    .attr('fill', 'white')
    .attr('pointer-events', 'none');

  // Simulation tick
  simulation.on('tick', () => {
    link
      .attr('x1', l => l.source.x).attr('y1', l => l.source.y)
      .attr('x2', l => l.target.x).attr('y2', l => l.target.y);
    node.attr('transform', d => `translate(${
      Math.max(16, Math.min(W - 16, d.x))
    },${
      Math.max(16, Math.min(H - 16, d.y))
    })`);
  });
}

/**
 * renderNodeList
 * --------------
 * Renders the scrollable node list below the graph.
 *
 * @param {object[]} nodes
 * @param {Set}      activeSet
 */
function renderNodeList(nodes, activeSet) {
  const list = document.getElementById('cp-node-list');
  if (!list) return;

  const sorted = [...nodes].sort((a, b) => {
    if (activeSet.has(a.id) && !activeSet.has(b.id)) return -1;
    if (!activeSet.has(a.id) && activeSet.has(b.id)) return 1;
    return b.timestamp - a.timestamp;
  });

  list.innerHTML = sorted.map(n => {
    const isActive = activeSet.has(n.id);
    const color = isActive ? COLORS.active : COLORS.stored;
    const preview = (n.compressed || 'No summary').slice(0, 50);
    const saved = (n.rawTokenEstimate || 0) - (n.compressedTokenEstimate || 0);

    return `
      <div class="cp-node-item${isActive ? ' cp-active' : ''}">
        <div class="cp-node-dot" style="background:${color}"></div>
        <div class="cp-node-body">
          <div class="cp-node-title">Turn ${(n.turnIndex ?? 0) + 1}</div>
          <div class="cp-node-meta">${preview}...</div>
          ${isActive ? '<div class="cp-node-meta" style="color:#534AB7">will be injected</div>' : ''}
        </div>
        <div class="cp-node-tok">↓${saved}tk</div>
      </div>`;
  }).join('');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildEdgesFromNodes(nodes) {
  return nodes
    .filter(n => n.parentId)
    .map(n => ({ source: n.parentId, target: n.id }));
}

function updateBadge(count) {
  const badge = document.getElementById('cp-sb-badge');
  if (badge) badge.textContent = `${count} node${count !== 1 ? 's' : ''}`;
}

function adjustMainLayout(sidebarOpen) {
  const main = document.querySelector('main') ?? document.body;
  main.style.paddingRight = sidebarOpen ? '290px' : '';
}

function getCurrentConversationId() {
  const m = window.location.href.match(/\/chat\/([a-f0-9-]+)/);
  return m ? `conv_${m[1]}` : null;
}

function sendToBg(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, res => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res);
    });
  });
}

/**
 * loadD3
 * ------
 * Dynamically loads D3.js from Cloudflare CDN and returns the global.
 */
function loadD3() {
  return new Promise((resolve, reject) => {
    if (window.d3) { resolve(window.d3); return; }
    const script = document.createElement('script');
    script.src = D3_CDN;
    script.onload = () => resolve(window.d3);
    script.onerror = () => reject(new Error('Failed to load D3.js'));
    document.head.appendChild(script);
  });
}
