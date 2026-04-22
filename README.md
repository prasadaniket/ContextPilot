# ContextPilot

**A Chrome Extension that compresses your Claude chat history into a smart token-saving context tree — so you can stay in long conversations without hitting the 5-hour reset wall.**

---

## The Problem

Every message you send to Claude makes it re-read the *entire* conversation from scratch. In a 20-message conversation, message #21 pays the token cost of all 20 previous messages plus itself. The longer you chat, the faster you burn through your limit. Hit the cap → wait 5 hours. Start a new chat → lose all context.

## The Solution

ContextPilot intercepts every outgoing request to Claude's API and replaces the full chat history with a **compressed context tree**:

- After each Claude response, the exchange is silently compressed into a ~70 token node using the Anthropic API
- Nodes are stored locally in IndexedDB as a linked tree
- On the next message, only the 2 most relevant past nodes are injected — not the full history
- Claude still gets full context on what matters. You save ~85% of tokens.

```
Before: 6 messages × ~900 tokens = 5,400 tokens per request
After:  2 relevant nodes × ~70 tokens + new prompt = ~200 tokens per request
```

---

## Features

- Automatic compression after every Claude response (background, zero latency)
- Smart relevance scoring (TF-IDF) picks only the most relevant past context
- Token savings dashboard in the popup
- 100% local — no server, no account, your prompts never leave your browser
- Falls back gracefully if anything breaks (never interrupts Claude)

---

## Installation (Developer Mode)

> The extension is not yet on the Chrome Web Store. Install manually in under 2 minutes.

1. **Clone this repo**
   ```bash
   git clone https://github.com/YOUR_USERNAME/context-pilot.git
   cd context-pilot
   ```

2. **Open Chrome Extensions**
   - Go to `chrome://extensions` in your browser

3. **Enable Developer Mode**
   - Toggle the switch in the top-right corner

4. **Load the extension**
   - Click **"Load unpacked"**
   - Select the `context-pilot/` folder

5. **Add your Anthropic API key**
   - Click the ContextPilot icon in your Chrome toolbar
   - Paste your API key (starts with `sk-ant-...`)
   - Click **Save**

6. **Go to claude.ai and start chatting**
   - ContextPilot activates automatically on `claude.ai`

---

## Getting an Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign in or create an account
3. Navigate to **API Keys** → **Create Key**
4. Copy the key and paste it into the ContextPilot popup

> The key is stored in `chrome.storage.local` — encrypted by Chrome, never synced or sent anywhere except to `api.anthropic.com` for compression.

> Compression uses `claude-haiku-3-5` which costs roughly $0.001 per compression call — negligible for everyday use.

---

## File Structure

```
context-pilot/
├── manifest.json              # Chrome extension config (Manifest V3)
├── background.js              # Service worker: API calls + message routing
├── content_script.js          # Injected into claude.ai: fetch interceptor
├── core/
│   ├── tree_store.js          # IndexedDB CRUD for prompt tree nodes
│   ├── keyword_extractor.js   # TF-IDF keyword scoring + node matching
│   ├── context_builder.js     # Assembles lean payload from tree + prompt
│   └── compressor.js          # Calls Anthropic API to compress exchanges
├── popup/
│   ├── popup.html             # Extension popup: token dashboard UI
│   ├── popup.js               # Reads tree stats, renders dashboard
│   └── popup.css              # Popup styles (light + dark mode)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## How It Works

### 1. Fetch Interception
`content_script.js` overrides `window.fetch` on claude.ai. When a message is sent, it catches the POST body before it leaves the browser.

### 2. Lean Context Injection
`background.js` is asked for a lean payload. It reads the tree from IndexedDB, scores nodes against the new prompt using TF-IDF cosine similarity, picks the top 2, and assembles a replacement payload with compressed context instead of full history.

### 3. Post-Response Compression
The response stream is cloned and watched for completion. Once Claude finishes responding, the full user + assistant exchange is sent to the Anthropic API for compression into a ~70 token summary node, which is saved to IndexedDB.

### 4. Linked Tree
Each node stores: compressed summary, keywords, parent node ID, raw vs compressed token counts, and conversation ID. This forms a linked tree that grows with your conversation but stays lean.

---

## Privacy

- All data is stored in your browser's IndexedDB (local, private)
- The only external call is to `api.anthropic.com` for compression
- Your Anthropic API key never leaves your machine except to authenticate with Anthropic
- No tracking, no analytics, no external servers

---

## Limitations

- Claude's API endpoint format may change. If interception stops working, check the `CLAUDE_COMPLETION_ENDPOINT` regex in `content_script.js`
- Compression quality depends on Haiku. For very technical conversations, some nuance may be lost in the summary — treat it as lossy-but-useful
- The extension does not currently work on mobile Chrome

---

## Roadmap

- [ ] Visual tree explorer in the popup
- [ ] Per-conversation token usage timeline chart
- [ ] Manual node editing (let users fix bad compressions)
- [ ] Export/import tree data
- [ ] Firefox support

---

## Contributing

PRs welcome. Please follow the commit format used in the project:

```
feat: add keyword extractor with TF-IDF scoring
fix: handle SSE stream completion edge case
refactor: split context_builder into smaller functions
docs: update README with API key setup steps
```

---

## License

MIT — do whatever you want with it.

---

## Author

Built by [YOUR_NAME](https://github.com/YOUR_USERNAME)

Inspired by the frustration of watching a 5-hour timer tick down after a great conversation with Claude.
