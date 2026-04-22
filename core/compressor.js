/**
 * ContextPilot v1.0 — compressor.js
 * --------------------------------
 * Calls Anthropic API to compress exchanges.
 *
 *
 * GitHub: https://github.com/prasadaniket/ContextPilot
 */
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// Use Haiku — fastest and cheapest, perfect for compression tasks
const COMPRESSION_MODEL = 'claude-haiku-4-5';

// The system prompt that instructs Claude to compress, not answer
const COMPRESSION_SYSTEM_PROMPT = `You are a lossless conversation compressor.
Summarize the following conversation exchange in UNDER 80 tokens.
PRESERVE: key decisions made, facts established, code discussed, task context, named entities, specific numbers.
DISCARD: greetings, filler words, repeated explanations, politeness phrases, meta-commentary.
Output ONLY the summary. No preamble, no labels, no surrounding quotes, no explanation.`;

/**
 * compressExchange
 * ----------------
 * Sends a user+assistant exchange to the Anthropic API and returns
 * a compressed summary string under 80 tokens.
 *
 * Falls back to naive truncation if the API call fails for any reason,
 * so compression failure never blocks the extension from working.
 *
 * @param {string} rawText - the full exchange text ("User: ...\n\nAssistant: ...")
 * @param {string} apiKey - Anthropic API key from chrome.storage.local
 * @returns {Promise<string>} compressed summary text
 */
export async function compressExchange(rawText, apiKey) {
  if (!apiKey) {
    throw new Error('No API key provided to compressExchange');
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: COMPRESSION_MODEL,
      max_tokens: 150,           // Slightly over target to give model room
      system: COMPRESSION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: rawText
        }
      ]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorBody}`);
  }

  const data = await response.json();

  // Extract the text content from the response
  const compressed = data?.content?.[0]?.text?.trim();

  if (!compressed) {
    throw new Error('Anthropic API returned empty content');
  }

  return compressed;
}
