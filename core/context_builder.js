/**
 * ContextPilot v1.0 — context_builder.js
 * --------------------------------
 * Assembles lean payload from tree + prompt.
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
/**
 * buildLeanPayload
 * ----------------
 * Takes Claude's original POST body and replaces the messages array with
 * a compressed-context version. The result looks like a normal Claude request
 * but uses far fewer tokens.
 *
 * Payload structure sent to Claude:
 *   messages: [
 *     { role: 'user', content: '[CONTEXT]\n<node1>\n<node2>\n[/CONTEXT]\n\n<new prompt>' }
 *   ]
 *
 * We inject context as part of the user message (not a system prompt) to
 * avoid conflicts with Claude's existing system prompt.
 *
 * @param {object} originalBody - the full original POST body from Claude's UI
 * @param {object[]} topNodes - 1–2 most relevant tree nodes
 * @param {string} userMessage - the raw new prompt from the user
 * @returns {object} modified POST body with lean messages array
 */
export function buildLeanPayload(originalBody, topNodes, userMessage) {
  // Shallow clone — we only modify messages, preserve all other fields
  // (model, temperature, system, etc. stay exactly as Claude sent them)
  const leanBody = { ...originalBody };

  // Build the context block from top nodes
  const contextBlock = buildContextBlock(topNodes);

  // Assemble the final user message
  const leanUserContent = contextBlock
    ? `${contextBlock}\n\n${userMessage}`
    : userMessage;

  // Replace the entire messages array with just the lean user message
  // This is the core of the token saving — instead of 50 turns, we send 1
  leanBody.messages = [
    {
      role: 'human',
      content: leanUserContent
    }
  ];

  return leanBody;
}

/**
 * buildContextBlock
 * -----------------
 * Formats the selected tree nodes into a readable context block.
 * Returns empty string if no nodes provided.
 *
 * Output format:
 *   [CONTEXT FROM PREVIOUS CONVERSATION]
 *   - <node1 compressed summary>
 *   - <node2 compressed summary>
 *   [END CONTEXT]
 *
 * @param {object[]} nodes - selected top-k nodes to include
 * @returns {string} formatted context block, or '' if no nodes
 */
function buildContextBlock(nodes) {
  if (!nodes || nodes.length === 0) return '';

  const summaries = nodes
    .filter(n => n.compressed && n.compressed.trim())
    .map(n => `- ${n.compressed.trim()}`);

  if (summaries.length === 0) return '';

  return [
    '[CONTEXT FROM PREVIOUS CONVERSATION]',
    ...summaries,
    '[END CONTEXT]'
  ].join('\n');
}
