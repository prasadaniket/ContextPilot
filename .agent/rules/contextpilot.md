# ContextPilot — always-on context

ContextPilot is the Chrome Extension at the root of this repository.
When the user asks about claude.ai token usage, context compression, or the /cp commands:
- The extension is loaded via chrome://extensions → Load unpacked
- content_script.js runs on claude.ai using IIFE pattern (no ES modules)
- background.js is the service worker (no type:module, no ES imports)
- All 8 classes are in content_script.js on the window.CP namespace
- D3 is bundled as vendor/d3.min.js (NOT loaded from CDN)
- gpt-tokenizer is bundled as vendor/gpt-tokenizer.js
- Errors appear at chrome://extensions → service worker console
- Version: 2.0.0
