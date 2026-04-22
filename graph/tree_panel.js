/**
 * ContextPilot v1.0 — tree_panel.js
 * --------------------------------
 * D3.js sidebar panel (code-review-graph pattern).
 *
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
    .cp-ph {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 0.5px solid rgba(0,0,0,0.1);
      background: var(--color-background-primary, white);
    }
    .cp-ph h3 { font-size: 13px; font-weight: 500; color: var(--color-text-primary, #1a1a1a); margin: 0; }
    .cp-badges { display: flex; gap: 6px; }
    .badge { font-size: 10px; padding: 2px 8px; border-radius: 20px; font-weight: 500; }
    .badge-teal { background: #E1F5EE; color: #085041; }
    .badge-purple { background: #EEEDFE; color: #3C3489; }
    @media(prefers-color-scheme: dark) {
      .badge-teal { background: #04342C; color: #9FE1CB; }
      .badge-purple { background: #26215C; color: #CECBF6; }
    }
    .cp-sb-close {
      width: 20px; height: 20px; border-radius: 50%;
      background: none; border: none; cursor: pointer;
      color: var(--color-text-secondary, #666); font-size: 14px;
      display: flex; align-items: center; justify-content: center;
      margin-left: 4px;
    }
    .cp-sb-close:hover { background: rgba(0,0,0,0.06); }
    #cp-d3-area { flex: 1; overflow: hidden; position: relative; background: var(--color-background-primary, white); }
    .cp-legend {
      display: flex; gap: 14px; padding: 8px 14px;
      border-top: 0.5px solid rgba(0,0,0,0.1);
      border-bottom: 0.5px solid rgba(0,0,0,0.1);
      background: var(--color-background-primary, white);
    }
    .leg-item { display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--color-text-secondary, #666); }
    .leg-dot { width: 8px; height: 8px; border-radius: 50%; }
    .cp-nodes { overflow-y: auto; padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; max-height: 220px; }
    .node-row {
      display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px;
      background: var(--color-background-primary, white);
      border: 0.5px solid rgba(0,0,0,0.1); cursor: pointer;
    }
    .node-row:hover { border-color: #534AB7; }
    .active-ring { box-shadow: 0 0 0 2px #534AB7; border-color: transparent; }
    .node-circle { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .node-text { flex: 1; overflow: hidden; }
    .node-title { font-size: 11px; font-weight: 500; color: var(--color-text-primary, #1a1a1a); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .node-sub { font-size: 10px; color: var(--color-text-secondary, #666); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .node-tok { font-size: 10px; color: var(--color-text-secondary, #666); white-space: nowrap; }
    .cp-tooltip {
      position: absolute; pointer-events: none;
      background: var(--color-background-primary, white);
      border: 0.5px solid rgba(0,0,0,0.12); border-radius: 6px; padding: 6px 8px;
      font-size: 10px; max-width: 200px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      display: none; z-index: 10000;
    }
  `;
  document.head.appendChild(style);

  panelEl = document.createElement('div');
  panelEl.id = 'cp-sidebar';
  panelEl.innerHTML = `
    <div class="cp-ph">
      <h3>Context tree</h3>
      <div style="display:flex;align-items:center;">
        <div class="cp-badges">
          <span class="badge badge-purple" id="cp-sb-badge">0 nodes</span>
          <span class="badge badge-teal" id="cp-sb-savings">0%</span>
        </div>
        <button class="cp-sb-close" id="cp-sb-close" title="Close">×</button>
      </div>
    </div>
    <div id="cp-d3-area"></div>
    <div class="cp-legend">
      <div class="leg-item"><div class="leg-dot" style="background:#534AB7;"></div> active path</div>
      <div class="leg-item"><div class="leg-dot" style="background:#1D9E75;"></div> stored</div>
      <div class="leg-item"><div class="leg-dot" style="background:#BA7517;"></div> current</div>
    </div>
    <div class="cp-nodes" id="cp-node-list"></div>
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
      <div class="node-row ${isActive ? 'active-ring' : ''}" style="${!isActive ? 'opacity:0.7;' : ''}">
        <div class="node-circle" style="background:${color}"></div>
        <div class="node-text">
          <div class="node-title">P${(n.turnIndex ?? 0) + 1} — ${preview}...</div>
          <div class="node-sub">${isActive ? 'relevance match — will be injected' : 'stored context'}</div>
        </div>
        <div class="node-tok">↓${saved}tk</div>
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
  
  const savings = document.getElementById('cp-sb-savings');
  if (savings) {
    // Calculate total savings %
    let raw = 0, comp = 0;
    currentNodes.forEach(n => {
      raw += n.rawTokenEstimate || 0;
      comp += n.compressedTokenEstimate || 0;
    });
    if (raw > 0) {
      const pct = Math.round(((raw - comp) / raw) * 100);
      savings.textContent = `↓${pct}%`;
      savings.style.display = 'inline';
    } else {
      savings.style.display = 'none';
    }
  }
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
