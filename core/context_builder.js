/**
 * ContextPilot — context_builder.js
 * --------------------------
 * Builds lean Claude request payloads using compressed context nodes.
 * Part of the ContextPilot Chrome Extension.
 * GitHub: https://github.com/YOUR_USERNAME/context-pilot
 */

/**
 * buildContextInjection
 * -----------
 * Builds the exact context injection block from the selected nodes and prompt.
 *
 * @param {Object[]} nodes - Top relevant compressed nodes.
 * @param {string} userPrompt - Current user prompt text.
 * @returns {string} Context injection text block.
 */
function buildContextInjection(nodes, userPrompt) {
  const lines = [
    '[CONTEXT FROM PAST CONVERSATION]',
    ...(nodes || []).map((node) => node.compressed || '').filter(Boolean),
    '[END CONTEXT]',
    '',
    '[USER MESSAGE]',
    userPrompt || ''
  ];
  return lines.join('\n');
}

/**
 * buildLeanPayload
 * -----------
 * Prepends compact context as a system message while preserving user messages.
 *
 * @param {Object} originalBody - Original Claude request payload.
 * @param {Object[]} topNodes - Up to two relevant compressed nodes.
 * @param {string} userPrompt - Current user prompt text.
 * @returns {Object} Modified request payload with context system message.
 */
export function buildLeanPayload(originalBody, topNodes, userPrompt) {
  const contextText = buildContextInjection(topNodes, userPrompt);
  const existingMessages = Array.isArray(originalBody.messages) ? originalBody.messages : [];
  const contextSystemMessage = {
    role: 'system',
    content: contextText
  };

  return {
    ...originalBody,
    messages: [contextSystemMessage, ...existingMessages]
  };
}
