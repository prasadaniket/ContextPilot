/**
 * ContextPilot — compressor.js
 * --------------------------
 * Calls Anthropic to compress a single user/assistant exchange.
 * Part of the ContextPilot Chrome Extension.
 * GitHub: https://github.com/YOUR_USERNAME/context-pilot
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-3-5';
const COMPRESSION_SYSTEM_PROMPT = `You are a lossless conversation compressor.
Summarize the following conversation exchange in UNDER 80 tokens.
PRESERVE: key decisions, facts established, code discussed, current task context, entities named.
DISCARD: greetings, filler words, repeated explanations, politeness.
Output ONLY the summary. No preamble, no labels, no quotes.`;

/**
 * compressExchange
 * -----------
 * Compresses one exchange into a short summary using Anthropic Messages API.
 *
 * @param {string} rawExchangeText - Full raw user and assistant exchange.
 * @param {string} apiKey - Anthropic API key from chrome storage.
 * @returns {Promise<string>} Compressed summary text.
 */
export async function compressExchange(rawExchangeText, apiKey) {
  try {
    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 120,
        system: COMPRESSION_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: rawExchangeText
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic error ${response.status}: ${errorText}`);
    }

    const payload = await response.json();
    const summary = payload?.content?.[0]?.text?.trim();
    if (!summary) {
      throw new Error('Anthropic returned empty compression summary.');
    }
    return summary;
  } catch (error) {
    console.error('[ContextPilot] compressExchange failed:', error);
    throw error;
  }
}
