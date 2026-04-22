# ContextPilot — Cursor AI Master Prompt

Paste this entire file into Cursor's AI prompt when starting or continuing the project.

---

## Project Identity

You are building **ContextPilot** — a Chrome Extension (Manifest V3) that sits on top of claude.ai and solves the token limit problem by:

1. **Intercepting** every outgoing fetch request to Claude's API from the browser
2. **Replacing** the full chat history payload with a smart compressed context tree
3. **Compressing** each exchange in the background (after Claude responds) using the Anthropic API
4. **Storing** compressed nodes in IndexedDB as a linked tree structure
5. **Showing** the user a popup dashboard with token savings, tree stats, and reset timer

The core insight: Claude re-reads the entire conversation on every message. ContextPilot replaces that with a compressed summary + only the 2–3 most relevant past nodes, dropping token usage by ~85%.

---

## Tech Stack (strict — do not deviate)

| Layer | Choice | Why |
|---|---|---|
| Language | Vanilla JavaScript (ES2022) | No build step, loads directly in Chrome |
| Storage | IndexedDB via `idb` v8 (CDN) | Async/await API, handles large trees |
| Compression | Anthropic API (`claude-haiku-3-5`) | Fast, cheap, perfect quality |
| Keyword matching | TF-IDF implemented from scratch | No dependencies, runs in-browser |
| UI | HTML + CSS (no frameworks) | Popup renders instantly, no overhead |
| Icons | PNG (16, 48, 128px) | Chrome extension requirement |

**No React. No Webpack. No TypeScript. No npm.** Every file loads directly. The extension folder IS the source.

---

## File Structure (exact — create every file listed)

```
context-pilot/
├── manifest.json              # Chrome extension config (MV3)
├── background.js              # Service worker: compression + API calls
├── content_script.js          # Injected into claude.ai: fetch interceptor
├── core/
│   ├── tree_store.js          # IndexedDB CRUD for prompt tree nodes
│   ├── keyword_extractor.js   # TF-IDF keyword scoring + node matching
│   ├── context_builder.js     # Assembles lean payload from tree + new prompt
│   └── compressor.js          # Calls Anthropic API to compress an exchange
├── popup/
│   ├── popup.html             # Extension popup: token dashboard UI
│   ├── popup.js               # Reads tree stats, renders dashboard
│   └── popup.css              # Popup styles (dark/light mode)
├── icons/
│   ├── icon16.png             # Toolbar icon
│   ├── icon48.png             # Extensions page icon
│   └── icon128.png            # Chrome Web Store icon
└── README.md                  # Setup guide + architecture explanation
```

---

## manifest.json — write this exactly

```json
{
  "manifest_version": 3,
  "name": "ContextPilot",
  "version": "0.1.0",
  "description": "Compress Claude chat history into a smart token-saving context tree. Stay in conversations longer.",
  "permissions": [
    "storage",
    "activeTab",
    "scripting",
    "alarms"
  ],
  "host_permissions": [
    "https://claude.ai/*",
    "https://api.anthropic.com/*"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://claude.ai/*"],
      "js": ["content_script.js"],
      "run_at": "document_idle",
      "all_frames": false
    }
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    },
    "default_title": "ContextPilot"
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

---

## Architecture Rules (follow these in every file you write)

### Rule 1 — Message passing only
`content_script.js` cannot call `IndexedDB` or `fetch` to external APIs directly (CSP blocks it). All heavy work goes through `chrome.runtime.sendMessage()` to `background.js`.

```
content_script.js  →  chrome.runtime.sendMessage()  →  background.js
```

### Rule 2 — API key security
The Anthropic API key is stored in `chrome.storage.local` under key `'cp_api_key'`. Never hardcode it. The popup settings tab lets users paste it in. background.js reads it via:

```javascript
const { cp_api_key } = await chrome.storage.local.get('cp_api_key');
```

### Rule 3 — Node schema (every node stored to IndexedDB must match this exactly)

```javascript
{
  id: 'node_<timestamp>_<random4>',     // string, unique
  conversationId: 'conv_<claudeId>',    // groups nodes by conversation
  parentId: 'node_...' | null,          // linked tree parent
  compressed: 'string under 100 tokens', // the summary
  keywords: ['array', 'of', 'strings'], // top 8 TF-IDF keywords
  rawTokenEstimate: 1240,               // estimated tokens before compression
  compressedTokenEstimate: 68,          // estimated tokens after
  timestamp: Date.now(),                // ms epoch
  turnIndex: 4                          // which turn in the conversation
}
```

### Rule 4 — Token estimation (no API call needed)
Estimate tokens as `Math.ceil(text.length / 4)`. This is accurate enough for budget tracking.

### Rule 5 — Compression prompt (use this exact system prompt for the Anthropic API call)

```
You are a lossless conversation compressor.
Summarize the following conversation exchange in UNDER 80 tokens.
PRESERVE: key decisions, facts established, code discussed, current task context, entities named.
DISCARD: greetings, filler words, repeated explanations, politeness.
Output ONLY the summary. No preamble, no labels, no quotes.
```

### Rule 6 — Context building strategy
When building the lean payload for a new prompt:
1. Take the full tree for the current conversation
2. Score every node against the new prompt using TF-IDF cosine similarity
3. Pick the top 2 nodes (never more — token budget)
4. Build this string as the context injection:

```
[CONTEXT FROM PAST CONVERSATION]
<node1.compressed>
<node2.compressed>
[END CONTEXT]

[USER MESSAGE]
<new prompt>
```

5. Prepend this to the messages array as a system message

### Rule 7 — When to compress
Compression fires AFTER Claude's full response streams in. Watch for the response stream ending in the content script, then fire `chrome.runtime.sendMessage({ type: 'COMPRESS_EXCHANGE', payload: { userMsg, assistantMsg, conversationId } })`.

---

## content_script.js — detailed spec

This file runs in the claude.ai page context. Its two jobs:

**Job 1 — Intercept outgoing fetch**
Override `window.fetch`. When the URL matches `/api/organizations/*/chat_conversations/*/completion` (Claude's message endpoint), intercept the POST body, send it to background.js to get a lean payload back, swap the body, then continue.

**Job 2 — Watch for response completion**
After the fetch resolves and the SSE stream ends (watch for `[DONE]` in the stream), extract the assistant's full response text and send it with the user message to background.js for compression.

Key detail: Claude uses streaming (SSE). You need to clone the response and read the stream to detect completion without breaking the UI's ability to read it too.

---

## background.js — detailed spec

Service worker. Handles these message types:

| Message type | What it does |
|---|---|
| `GET_LEAN_CONTEXT` | Reads tree from IndexedDB, scores nodes, returns lean payload |
| `COMPRESS_EXCHANGE` | Calls Anthropic API, stores new node to IndexedDB |
| `GET_STATS` | Returns aggregate stats for popup dashboard |
| `SAVE_API_KEY` | Writes API key to chrome.storage.local |
| `GET_API_KEY` | Returns masked API key for popup display |

---

## core/tree_store.js — detailed spec

Wraps IndexedDB. Database name: `ContextPilotDB`. Object store: `nodes`. Index on `conversationId`.

Export these functions:
- `saveNode(node)` — adds a node
- `getNodesByConversation(conversationId)` — returns all nodes for a conversation, sorted by timestamp
- `getAllStats()` — returns `{ totalNodes, totalRawTokens, totalCompressedTokens, tokensSaved }`
- `clearConversation(conversationId)` — deletes all nodes for one conversation
- `clearAll()` — wipes the entire database

---

## core/keyword_extractor.js — detailed spec

Implements TF-IDF from scratch. No libraries.

Export these functions:
- `extractKeywords(text, topN = 8)` — returns array of top N keywords by TF-IDF score
- `scoreNodeRelevance(node, queryText)` — returns a 0–1 cosine similarity score
- `findTopNodes(nodes, queryText, topK = 2)` — returns top K nodes sorted by relevance

Stop words list to filter out (include at minimum): `['the', 'a', 'an', 'is', 'it', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'but', 'i', 'you', 'we', 'this', 'that', 'with', 'can', 'how', 'what', 'my', 'your', 'do', 'did', 'was', 'are', 'be', 'have', 'has', 'had']`

---

## popup/popup.html — detailed spec

Single-page popup, 360px wide. Three sections:
1. **Header** — ContextPilot logo + version
2. **Stats cards** — 4 metric cards: Tokens Saved, Nodes Stored, Conversations, Compression Ratio
3. **Settings section** — API key input (masked), save button, "Clear all data" button

No external CSS frameworks. Use CSS variables for theming. Must work in both light and dark mode (`prefers-color-scheme`).

---

## Error handling rules

- Every `async` function must have a `try/catch`
- If the Anthropic API call fails, store the raw text as the node's compressed field (graceful degradation — lossless fallback)
- If `content_script.js` fails to intercept, allow the original fetch to proceed unmodified (never break Claude)
- Log errors with prefix `[ContextPilot]` so they're findable in DevTools

---

## Comments standard (use in every file)

```javascript
/**
 * functionName
 * -----------
 * One sentence saying what this does.
 *
 * @param {Type} paramName - what it is
 * @returns {Type} what comes back
 */
```

Every file must start with a file-level comment:

```javascript
/**
 * ContextPilot — filename.js
 * --------------------------
 * One sentence role of this file in the system.
 * Part of the ContextPilot Chrome Extension.
 * GitHub: https://github.com/YOUR_USERNAME/context-pilot
 */
```

---

## What to build first (in this order)

1. `manifest.json` — gets the extension loadable in Chrome immediately
2. `core/tree_store.js` — foundation everything else reads/writes to
3. `background.js` — skeleton with message listener, no logic yet
4. `content_script.js` — intercept only, log the payload to console, don't modify it yet
5. `core/keyword_extractor.js` — pure functions, easy to unit test in console
6. `core/compressor.js` — the Anthropic API call
7. `core/context_builder.js` — assembles the lean payload
8. Wire `background.js` fully — connect all the above
9. Wire `content_script.js` fully — swap payload, watch stream end
10. `popup/` — dashboard UI last, when the engine works

---

## Testing checklist before each commit

- [ ] Load unpacked in `chrome://extensions` with no errors in service worker console
- [ ] Open claude.ai, open DevTools console, confirm `[ContextPilot] Intercepted request` log appears
- [ ] Send a message, confirm `[ContextPilot] Compression complete — node saved` log appears
- [ ] Open popup, confirm stats update after each message
- [ ] Send 5 messages in a long conversation, check IndexedDB in DevTools → Application → IndexedDB
- [ ] Verify Claude's responses still work correctly (extension must be invisible to the user experience)

---

## GitHub setup commands (run after files are created)

```bash
git init
git add .
git commit -m "init: ContextPilot v0.1.0 scaffold"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/context-pilot.git
git push -u origin main
```

Commit message format to follow throughout development:
- `feat: add keyword extractor with TF-IDF scoring`
- `fix: handle SSE stream completion edge case`
- `refactor: split context_builder into smaller functions`
- `docs: update README with API key setup steps`
