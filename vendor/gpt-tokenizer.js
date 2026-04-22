/**
 * ContextPilot — gpt-tokenizer.js
 * --------------------------
 * Tokenizer compatibility shim with graceful fallback for token counting.
 * Part of the ContextPilot Chrome Extension.
 * GitHub: https://github.com/YOUR_USERNAME/context-pilot
 */

(() => {
  /**
   * countTokensFallback
   * -----------
   * Estimates token count with a simple char-to-token heuristic fallback.
   *
   * @param {string} text - Input text to estimate.
   * @returns {number} Approximate token count.
   */
  function countTokensFallback(text) {
    return Math.ceil((text || '').length / 4);
  }

  /**
   * resolveTokenizer
   * -----------
   * Resolves a real tokenizer when available or returns fallback wrapper.
   *
   * @returns {{ countTokens: Function }} Tokenizer-compatible object.
   */
  function resolveTokenizer() {
    try {
      if (globalThis.GPTTokenizer_o200k_base?.countTokens) {
        return globalThis.GPTTokenizer_o200k_base;
      }
    } catch (_error) {
      // Ignore and return fallback.
    }

    return { countTokens: countTokensFallback };
  }

  globalThis.ContextPilotTokenizer = resolveTokenizer();
})();
