<div align="center">
  <img src="icons/icon128.png" alt="ContextPilot Logo" width="128"/>
  <h1>ContextPilot</h1>
  <p><strong>One extension to rule your Claude token limits.</strong></p>
  
  [![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)]()
  [![License](https://img.shields.io/badge/license-MIT-green.svg)]()
  [![Chrome](https://img.shields.io/badge/browser-Chrome-orange.svg)]()
</div>

<br />

ContextPilot is a powerful Chrome Extension for **claude.ai** that solves the token limit wall. By silently compressing your chat history locally, it gives you infinite conversation memory without burning through your hourly limits.

## 📋 Table of Contents
- [The Problem](#-the-problem)
- [The Solution](#-the-solution)
- [Key Features](#-key-features)
- [Installation](#-installation)
- [Tech Stack](#-tech-stack)
- [Architecture](#-architecture)
- [Command Reference](#-command-reference)
- [API Key Setup](#-api-key-setup)
- [Privacy & Security](#-privacy--security)
- [Contributing](#-contributing)
- [License](#-license)

## 🚨 The Problem

Every message you send to Claude makes it re-read the *entire* conversation from scratch. In a 20-message conversation, message #21 pays the token cost of all 20 previous messages plus itself. The longer you chat, the faster you burn through your limit. Hit the cap → wait 5 hours. Start a new chat → lose all context.

## 💡 The Solution

ContextPilot intercepts every outgoing request to Claude's API and replaces the full chat history with a **compressed context tree**. It uses Anthropic's API locally to compress exchanges into ~70 token nodes, storing them in IndexedDB. When you chat, it injects only the most relevant nodes via advanced TF-IDF matching.

```text
Every message WITHOUT ContextPilot:
[Msg 1][Msg 2][Msg 3][Msg 4][Msg 5][Msg 6] + New prompt = ~5,000 tokens 🔴

Every message WITH ContextPilot:
[P3 summary 68tk][P6 summary 72tk] + New prompt = ~200 tokens ✅

Savings: 96%
```

## ✨ Key Features

- **Automatic Compression:** Silently compresses history after every response using the fast Haiku model.
- **Smart Relevance (TF-IDF):** Injects only the most mathematically relevant context nodes for the current prompt.
- **Live Token HUD:** Displays accurate session/weekly usage and cache timers natively integrated into the claude.ai interface.
- **Integrated Command System:** Local `/cp` slash commands intercepted seamlessly from the chat box.
- **Interactive Graph:** A live D3.js visualizer panel representing your conversation tree.
- **Zero-Friction Install:** No build steps, no Git cloning required. Just download and drop.

## 🚀 Installation

Install the extension locally in just 3 steps:

1. Download **[context-pilot-v1.0.1.zip](https://github.com/prasadaniket/ContextPilot/releases/latest/download/context-pilot-v1.0.1.zip)** directly.
2. Go to `chrome://extensions` in Chrome and toggle **Developer mode** (top right corner).
3. **Drag and drop** the downloaded zip file onto the extensions page.

You're done! Open [claude.ai](https://claude.ai) and look for the ContextPilot HUD at the top.

## 🛠 Tech Stack

Built entirely with modern web standards and lightweight libraries to ensure zero bloat:

- **Core/Runtime:** Vanilla JavaScript (ES6+), Chrome Extension APIs (Manifest V3)
- **Database:** IndexedDB (`idb` for async transactions)
- **Algorithms:** Custom TF-IDF Engine, Cosine Similarity math for semantic relevance
- **Visualization:** [D3.js](https://d3js.org/) (Force-directed graphs)
- **Tokenization:** `gpt-tokenizer` (Vendored for exact client-side BPE counting)
- **CI/CD:** GitHub Actions for automated `.zip` releases

## 📐 Architecture

ContextPilot operates on four distinct layers integrated into a single seamless pipeline:

![Architecture Map](diagram/contextpilot_repo_integration_map.svg)

## ⌨️ Command Reference

ContextPilot intercepts commands prefixed with `/cp` natively in the Claude chat box.

![Command System flow](diagram/cp_command_system.svg)

| Command | Description |
|---|---|
| `/cp` or `/cp-status` | Prints live token stats as an injected chat message. |
| `/cp-tree` | Toggles the interactive D3 graph sidebar panel. |
| `/cp-skip` | Skips compression for the next message only. |
| `/cp-pause` / `/cp-resume` | Pauses or resumes all compression globally. |
| `/cp-reset` | Clears the context tree for the current conversation. |
| `/cp-export` | Downloads the current conversation tree as a JSON file. |
| `/cp-mode <light\|deep>` | Sets context injection depth to 1 node (light) or 3 nodes (deep). |
| `/cp-help` | Prints all commands as a system message in chat. |

## 🔑 API Key Setup

ContextPilot uses Anthropic's API (`claude-3-haiku-20240307`) to generate high-quality compressed summaries (costing roughly $0.001 per call).

![Auto API Key Flow](diagram/auto_api_key_flow.svg)

**Option A: Auto Grabber**
1. Click the ContextPilot icon in your Chrome toolbar.
2. Click **"Get API key automatically"**.
3. A tab will briefly open `console.anthropic.com` and automatically extract a key securely.

**Option B: Manual Entry**
1. Go to [console.anthropic.com](https://console.anthropic.com).
2. Generate a new API key.
3. Paste your key into the ContextPilot extension popup settings.

## 🔒 Privacy & Security

Your data never leaves your machine. 
- **100% Local Storage:** All conversation nodes and keywords are stored in your browser's local IndexedDB.
- **Secure Keys:** Your API key is encrypted and stored securely in `chrome.storage.local`.
- **No Middlemen:** The ONLY external network call made is directly to `api.anthropic.com` for local compression logic. There are no tracking servers, telemetry, or analytics.

## 🤝 Contributing

Contributions, issues, and feature requests are highly welcome! 
1. Fork the project.
2. Create your feature branch (`git checkout -b feature/AmazingFeature`).
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

## 🏆 Acknowledgements

This extension builds upon excellent open-source foundations. Special thanks to:
- **[she-llac/claude-counter](https://github.com/she-llac/claude-counter)** — Display layer and React SPA DOM-observer logic.
- **[gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done)** — Command routing and interceptor pattern inspiration.
- **[tirth8205/code-review-graph](https://github.com/tirth8205/code-review-graph)** — Core D3.js force-directed graph logic.

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
