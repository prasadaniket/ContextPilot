/**
 * ContextPilot — vendor/gpt-tokenizer.js
 * ----------------------------------------
 * PLACEHOLDER — replace this file with the real vendored tokenizer.
 *
 * HOW TO GET THE REAL FILE:
 * ─────────────────────────
 * 1. Clone claude-counter: https://github.com/she-llac/claude-counter
 * 2. Copy their vendored tokenizer file from:
 *    claude-counter/src/vendor/gpt-tokenizer/ (or wherever they include it)
 *    into THIS file's location: context-pilot/vendor/gpt-tokenizer.js
 *
 * OR — download gpt-tokenizer directly:
 *    npm install gpt-tokenizer
 *    Copy node_modules/gpt-tokenizer/dist/encoding/o200k_base.js here
 *    Wrap its export as: window.GPTTokenizer_o200k_base = { encode }
 *
 * WHY THIS IS NEEDED:
 * ───────────────────
 * This file must export a global `GPTTokenizer_o200k_base` object with an
 * `encode(text)` method that returns a token array. The content_script.js
 * calls `GPTTokenizer_o200k_base.encode(text).length` for accurate token counts.
 *
 * If this file is missing or the global is not set, content_script.js falls
 * back to the rough `Math.ceil(text.length / 4)` estimate automatically.
 * The extension still works — token counts are just less accurate.
 *
 * CREDIT:
 * ───────
 * gpt-tokenizer by niieani — https://github.com/niieani/gpt-tokenizer (MIT)
 * Used in claude-counter by she-llac — https://github.com/she-llac/claude-counter (MIT)
 */

// Minimal fallback stub — replaced by the real tokenizer
// Approximates 1 token ≈ 4 characters
window.GPTTokenizer_o200k_base = {
  encode: function(text) {
    if (!text) return [];
    // Return an array whose .length approximates token count
    return new Array(Math.ceil(text.length / 4));
  }
};
