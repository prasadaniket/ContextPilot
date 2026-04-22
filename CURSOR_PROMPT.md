# ContextPilot v1.0 — Master Cursor Prompt
# ===========================================
# Paste this ENTIRE file into Cursor / Claude Code / Antigravity when starting.
# This is the single source of truth for the entire project.
#
# Sources merged into this build:
#   - claude-counter (she-llac, MIT)       → display layer, SSE, tokenizer
#   - get-shit-done (gsd-build, MIT)       → /cp command system design pattern
#   - code-review-graph (tirth8205, MIT)   → D3 graph visualization, node structure
#   - ContextPilot (original)              → compression engine, tree store, context builder

---

## Project Identity

**ContextPilot** is a Chrome Extension (Manifest V3) for claude.ai that solves the token limit wall by combining 4 open-source approaches into one extension with 4 layers:

| Layer | Source | What it does |
|---|---|---|
| Display | claude-counter (she-llac) | Live HUD: tokens, session/weekly bars, cache timer |
| Commands | get-shit-done pattern | /cp slash commands intercepted from chat input |
| Compression | ContextPilot original | Fetch intercept → lean payload → background compression |
| Graph panel | code-review-graph (tirth8205) | D3.js sidebar showing the live prompt tree |

Plus 3 new original features:
1. One-click .zip install (no git clone)
2. Automatic API key acquisition from console.anthropic.com
3. Live D3 graph panel injected into claude.ai sidebar

---

## Complete File Structure (create every file)

```
context-pilot/
├── manifest.json
├── background.js
├── content_script.js
│
├── core/
│   ├── tree_store.js          # IndexedDB CRUD
│   ├── keyword_extractor.js   # TF-IDF cosine similarity
│   ├── context_builder.js     # Lean payload assembly
│   └── compressor.js          # Anthropic API compression call
│
├── commands/
│   └── cp_commands.js         # /cp slash command router (GSD pattern)
│
├── graph/
│   └── tree_panel.js          # D3.js sidebar panel (code-review-graph pattern)
│
├── features/
│   └── api_key_grabber.js     # Auto API key from console.anthropic.com
│
├── vendor/
│   └── gpt-tokenizer.js       # o200k_base tokenizer (from claude-counter)
│
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
│
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
│
├── CURSOR_PROMPT.md           # This file
└── README.md
```

---

## manifest.json (write exactly)

```json
{
  "manifest_version": 3,
  "name": "ContextPilot",
  "version": "1.0.0",
  "description": "Token counter + compression + live graph panel for claude.ai. Stay in long conversations without hitting limits.",
  "permissions": [
    "storage", "activeTab", "scripting",
    "cookies", "alarms", "tabs"
  ],
  "host_permissions": [
    "https://claude.ai/*",
    "https://api.anthropic.com/*",
    "https://console.anthropic.com/*"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://claude.ai/*"],
      "js": ["vendor/gpt-tokenizer.js", "content_script.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://console.anthropic.com/*"],
      "js": ["features/api_key_grabber.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

---

## Architecture Rules

### Rule 1 — Message passing
content_script.js → chrome.runtime.sendMessage → background.js for ALL external calls.
CSP blocks fetch() to api.anthropic.com from content scripts.

### Rule 2 — Single SSE pass
`response.tee()` splits the Claude stream once.
Left copy → Claude's UI.
Right copy → `readSSEStream()` which extracts BOTH:
  - message_limit events (session/weekly display fractions)
  - text_delta events (assistant text for compression)

### Rule 3 — /cp command interception (GSD pattern)
content_script.js watches the chat textarea with a MutationObserver.
When user submits a message starting with `/cp`, intercept:
  1. Prevent the message from being sent to Claude
  2. Clear the textarea
  3. Route to cp_commands.js handler
  4. Execute the command locally

```javascript
// In content_script.js — command detection
function interceptCpCommand(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/cp')) return false;
  handleCpCommand(trimmed);
  return true; // prevents normal send
}
```

### Rule 4 — IndexedDB node schema
```javascript
{
  id: 'node_<timestamp>_<rand4>',
  conversationId: 'conv_<uuid>',
  parentId: 'node_...' | null,
  compressed: '<summary under 80 tokens>',
  keywords: ['array', 'of', 'top8'],
  rawTokenEstimate: 1240,
  compressedTokenEstimate: 68,
  timestamp: Date.now(),
  turnIndex: 4
}
```

### Rule 5 — D3 graph panel (code-review-graph pattern)
Inject a `<div id="cp-sidebar">` into claude.ai's layout.
Use D3.js force simulation with:
  - Nodes = prompt tree nodes (circles, radius ∝ token count)
  - Edges = parent-child links
  - Color = relevance to current query (purple = high, gray = low)
  - Active path = highlighted with thicker stroke
  - Hover tooltip = node summary, tokens saved, relevance score

D3 loads from: `https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js`

### Rule 6 — Compression prompt (exact)
```
You are a lossless conversation compressor.
Summarize this exchange in UNDER 80 tokens.
PRESERVE: key decisions, facts, code, task context, named entities, numbers.
DISCARD: greetings, filler, repeated explanations, politeness.
Output ONLY the summary. No preamble, labels, or quotes.
```

### Rule 7 — Storage bridge for popup
After each SSE stream, content_script.js writes:
```javascript
chrome.storage.local.set({
  cp_session_usage: state.sessionUsage,
  cp_weekly_usage: state.weeklyUsage,
  cp_session_reset_ms: state.sessionResetMs,
  cp_weekly_reset_ms: state.weeklyResetMs,
  cp_token_count: state.tokenCount,
  cp_cache_expires: state.cacheExpiresAt,
  cp_tokens_saved: state.tokensSaved
});
```
popup.js reads these keys directly — no message passing needed for display.

### Rule 8 — Never break Claude
Every fetch intercept wraps in try/catch.
If ANY step fails, the original unmodified payload goes through.
User must never notice the extension is running.

---

## Feature 1 — One-click .zip install

### What to build
A GitHub Actions workflow (`.github/workflows/release.yml`) that:
1. On every push to `main`, packages the extension folder as `context-pilot-vX.X.X.zip`
2. Uploads it as a GitHub Release asset
3. The README links directly to the latest release zip

### GitHub Action
```yaml
name: Release Extension
on:
  push:
    tags: ['v*']
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Package extension
        run: |
          zip -r context-pilot-${{ github.ref_name }}.zip \
            manifest.json background.js content_script.js \
            core/ commands/ graph/ features/ vendor/ popup/ icons/ \
            --exclude "*.md" "CURSOR_PROMPT.md" ".git/*" ".github/*"
      - name: Create Release
        uses: softprops/action-gh-release@v1
        with:
          files: context-pilot-${{ github.ref_name }}.zip
          generate_release_notes: true
```

### Install instructions in README
```
1. Download context-pilot-v1.0.0.zip from Releases
2. Go to chrome://extensions → enable Developer mode
3. Drag and drop the zip onto the page
Done. No git clone. No terminal.
```

---

## Feature 2 — Automatic API key acquisition

### How it works
1. User clicks "Get API key automatically" in popup
2. background.js opens a new tab to `https://console.anthropic.com/settings/keys`
3. `features/api_key_grabber.js` (injected into console.anthropic.com) watches for:
   - The API keys page to load
   - Clicks "Create key" button
   - Reads the generated key from the modal input
   - Sends `{ type: 'API_KEY_CAPTURED', key: '...' }` to background.js
4. background.js saves the key to chrome.storage.local and closes the tab
5. Popup shows "Key saved automatically"

### api_key_grabber.js spec
```javascript
// Injected into console.anthropic.com only
// Listens for a trigger from background.js via chrome.runtime.onMessage
// When triggered:
//   1. Find the "Create key" button and click it
//   2. Wait for the modal to appear (MutationObserver)
//   3. Read the key value from the input[type=text] in the modal
//   4. Send it back via chrome.runtime.sendMessage
//   5. Optionally click "Done" to close the modal
```

### background.js handler
```javascript
case 'GRAB_API_KEY':
  // Open console.anthropic.com in a new tab
  // Wait for it to load (chrome.tabs.onUpdated)
  // Send TRIGGER_GRAB to the tab's content script
  // Listen for API_KEY_CAPTURED message back
  // Save the key, close the tab, notify popup
```

### Security notes
- The key NEVER leaves the browser
- Only `chrome.storage.local` (encrypted by Chrome)
- The console.anthropic.com tab is closed immediately after capture
- User must already be logged in to console.anthropic.com
- If user is not logged in, show clear error: "Please log into console.anthropic.com first"

---

## Feature 3 — Live D3 graph panel in claude.ai

### What to inject
A sidebar panel on the RIGHT side of claude.ai's chat area (280px wide).
The panel slides in when the user types `/cp-tree` or clicks the tree icon in the HUD.

### graph/tree_panel.js spec

```javascript
// Loads D3 from CDN, then:
// 1. Creates a sidebar div #cp-sidebar in document.body
// 2. Renders a force-directed D3 graph inside it
// 3. Nodes = IndexedDB tree nodes for current conversation
// 4. Edges = parentId → id links
// 5. Node radius = 8 + (rawTokenEstimate / 200) capped at 20
// 6. Node color:
//    purple (#534AB7) = in active relevance path
//    teal   (#1D9E75) = stored, not in active path
//    amber  (#BA7517) = current new prompt being typed
//    gray   (#888780) = old nodes, low relevance
// 7. Edge width:
//    2.5px purple = active path edges
//    1px gray = inactive edges
// 8. Hover tooltip shows: node summary, tokens saved, relevance score
// 9. Updates in real-time as new nodes are added after each exchange
// 10. Panel is draggable (can be moved left or right)

function renderGraph(nodes, edges, activeNodeIds) {
  // D3 force simulation
  // d3.forceSimulation(nodes)
  //   .force('link', d3.forceLink(edges))
  //   .force('charge', d3.forceManyBody().strength(-60))
  //   .force('center', d3.forceCenter(width/2, height/2))
}
```

### Panel HTML structure
```html
<div id="cp-sidebar">
  <div class="cp-panel-header">
    <span>Context tree</span>
    <span class="cp-stat-badge">8 nodes · ↓87%</span>
    <button onclick="closeSidebar()">×</button>
  </div>
  <div id="cp-d3-graph"><!-- D3 renders here --></div>
  <div class="cp-legend">
    <span>● active path</span>
    <span>● stored</span>
    <span>● current</span>
  </div>
  <div id="cp-node-list"><!-- Top relevant nodes list --></div>
</div>
```

### Positioning on claude.ai
```javascript
// claude.ai's main chat div has a max-width — inject the sidebar next to it
// Use position: fixed, right: 0, top: 60px, width: 280px, height: calc(100vh - 120px)
// Add padding-right: 290px to the main chat container so content doesn't overlap
```

---

## /cp Command System (commands/cp_commands.js)

Inspired by GSD's slash command pattern. All commands intercepted locally — never sent to Claude.

### Command table

| Command | What it does | Implementation |
|---|---|---|
| `/cp` | Show status popup with tree stats | Opens popup programmatically |
| `/cp-tree` | Toggle the D3 graph sidebar | Calls tree_panel.js open/close |
| `/cp-status` | Print stats as a chat message from "ContextPilot" | Injects fake message bubble |
| `/cp-skip` | Skip compression for the next message only | Sets `state.skipNext = true` |
| `/cp-pause` | Pause ALL compression (toggle) | `state.compressionPaused = true` |
| `/cp-resume` | Resume compression | `state.compressionPaused = false` |
| `/cp-reset` | Clear tree for current conversation | Sends CLEAR_CONVERSATION to background |
| `/cp-export` | Download tree as JSON file | Reads IndexedDB, triggers download |
| `/cp-mode deep` | Use top 3 nodes instead of 2 | `state.contextDepth = 3` |
| `/cp-mode light` | Use only top 1 node | `state.contextDepth = 1` |
| `/cp-help` | Print all commands as a system message | Injects formatted message |

### /cp-status output format (injected as fake message)
```
ContextPilot v1.0 — current conversation
─────────────────────────────────────────
Nodes in tree:    8
Tokens saved:     4,821
Compression:      87%
Session usage:    43%
Cache expires:    2m 14s
Compression:      active
─────────────────────────────────────────
Type /cp-help for all commands
```

### Command interception code pattern (adapted from GSD)
```javascript
// In content_script.js
function watchForCpCommands() {
  // Watch for form submit / Enter key in Claude's textarea
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const textarea = document.querySelector('[data-testid="chat-input"]')
                  ?? document.querySelector('div[contenteditable="true"]');
    if (!textarea) return;
    const text = textarea.textContent || textarea.value || '';
    if (text.trim().startsWith('/cp')) {
      e.preventDefault();
      e.stopPropagation();
      routeCpCommand(text.trim());
      clearTextarea(textarea);
    }
  }, true); // capture phase — fires before Claude's own handler
}
```

---

## Build Order (write code in this sequence)

1. `manifest.json` — load extension in Chrome immediately
2. `vendor/gpt-tokenizer.js` — get real file from claude-counter repo
3. `core/tree_store.js` — IndexedDB foundation
4. `background.js` — skeleton message router only
5. `content_script.js` — HUD only (display layer), test it shows in page
6. Add SSE parsing — confirm message_limit events in console
7. Add fetch intercept to content_script.js — log only, don't modify
8. `core/keyword_extractor.js` — pure functions, test in console
9. `core/compressor.js` — Anthropic API call
10. `core/context_builder.js` — payload assembly
11. Wire background.js fully
12. Enable payload swap in content_script.js
13. Add chrome.storage.local writes for popup bridge
14. `commands/cp_commands.js` — slash command router
15. Add command interception to content_script.js
16. `graph/tree_panel.js` — D3 sidebar
17. `features/api_key_grabber.js` — auto key capture
18. `popup/` — full dashboard
19. `.github/workflows/release.yml` — zip release action
20. `README.md` — full documentation

---

## Testing Checklist

- [ ] Extension loads in chrome://extensions with no service worker errors
- [ ] HUD bar appears at bottom of claude.ai
- [ ] Sending a message shows token count update in HUD
- [ ] Session/weekly bars update after first response
- [ ] Typing `/cp-help` in Claude's chat fires the command locally (no message sent to Claude)
- [ ] Typing `/cp-tree` opens the D3 sidebar
- [ ] After 3 messages, IndexedDB has 3 nodes (DevTools → Application → IndexedDB → ContextPilotDB)
- [ ] After 3 messages, token bar in sidebar shows reduced payload
- [ ] "Get API key automatically" in popup opens console.anthropic.com tab and returns a key
- [ ] Clicking "Export" downloads a valid JSON file
- [ ] Claude's responses still work perfectly (extension invisible to user experience)

---

## Commit Convention

```
feat: add /cp-tree D3 sidebar panel
feat: auto API key from console.anthropic.com
feat: GitHub Actions zip release workflow
fix: handle SSE message_limit nested structure
fix: /cp command intercept on Firefox-style keypaths
refactor: merge SSE readers into single readSSEStream
chore: add real gpt-tokenizer o200k_base encoding
docs: update README with all 3 new features
```

---

## GitHub Setup

```bash
git init
git add .
git commit -m "feat: ContextPilot v1.0 — 4-repo merge + 3 new features"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/context-pilot.git
git push -u origin main

# Create first release to trigger the zip workflow
git tag v1.0.0
git push origin v1.0.0
```

---

## README.md — write this in full

The README must include:
1. A hero line: "One extension to rule your Claude token limits"
2. The problem section (with the re-reads-everything explanation)
3. A feature list with all 7 things the extension does
4. A visual ASCII diagram showing the compression flow
5. Installation section with ONLY the zip download method (no git clone)
6. API key section — show both manual and auto methods
7. /cp command reference table (all 11 commands)
8. Architecture section explaining all 4 layers and their source repos
9. Privacy section (all local, no tracking)
10. Credits: claude-counter (she-llac), GSD (gsd-build), code-review-graph (tirth8205)
11. License: MIT

### README ASCII diagram to include
```
Every message WITHOUT ContextPilot:
[Msg 1][Msg 2][Msg 3][Msg 4][Msg 5][Msg 6] + New prompt = ~5,000 tokens 🔴

Every message WITH ContextPilot:
[P3 summary 68tk][P6 summary 72tk] + New prompt = ~200 tokens ✅

Savings: 96%
```

---

## Attribution block (must appear in every file header)

```javascript
/**
 * ContextPilot v1.0 — [filename]
 * --------------------------------
 * [one line role description]
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
 * GitHub: https://github.com/YOUR_USERNAME/context-pilot
 */
```

---

## The one question Cursor will ask — answer it

When Cursor asks "where do I get the real gpt-tokenizer.js?":

```
git clone https://github.com/she-llac/claude-counter.git
# Find the tokenizer file in their src/ folder
# Copy it to context-pilot/vendor/gpt-tokenizer.js
# It should export window.GPTTokenizer_o200k_base = { encode(text) }
```

The stub in vendor/gpt-tokenizer.js falls back to length/4 — the extension works without it.
