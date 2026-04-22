/**
 * ContextPilot — keyword_extractor.js
 * --------------------------
 * TF-IDF keyword scoring and node relevance ranking for context selection.
 * Part of the ContextPilot Chrome Extension.
 * GitHub: https://github.com/YOUR_USERNAME/context-pilot
 */

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'it', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'but',
  'i', 'you', 'we', 'this', 'that', 'with', 'can', 'how', 'what', 'my', 'your', 'do', 'did',
  'was', 'are', 'be', 'have', 'has', 'had'
]);

/**
 * tokenize
 * -----------
 * Converts raw text into normalized tokens for TF-IDF computation.
 *
 * @param {string} text - Input text.
 * @returns {string[]} Filtered token list.
 */
function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

/**
 * toTermFrequencyMap
 * -----------
 * Builds normalized term frequency values for one tokenized document.
 *
 * @param {string[]} tokens - Token list for a document.
 * @returns {Map<string, number>} Term to normalized TF value map.
 */
function toTermFrequencyMap(tokens) {
  const map = new Map();
  if (!tokens.length) {
    return map;
  }

  for (const token of tokens) {
    map.set(token, (map.get(token) || 0) + 1);
  }

  const totalTerms = tokens.length;
  for (const [term, count] of map.entries()) {
    map.set(term, count / totalTerms);
  }
  return map;
}

/**
 * inverseDocumentFrequency
 * -----------
 * Computes IDF score for one term within a corpus.
 *
 * @param {string} term - Term to score.
 * @param {string[][]} corpus - Corpus represented as tokenized documents.
 * @returns {number} IDF value with smoothing.
 */
function inverseDocumentFrequency(term, corpus) {
  const docsContainingTerm = corpus.reduce((count, tokens) => (
    tokens.includes(term) ? count + 1 : count
  ), 0);
  return Math.log((1 + corpus.length) / (1 + docsContainingTerm)) + 1;
}

/**
 * buildTfIdfVector
 * -----------
 * Creates a TF-IDF vector map from one tokenized document and corpus.
 *
 * @param {string[]} tokens - Current document tokens.
 * @param {string[][]} corpus - Tokenized corpus.
 * @returns {Map<string, number>} Term to TF-IDF score map.
 */
function buildTfIdfVector(tokens, corpus) {
  const tf = toTermFrequencyMap(tokens);
  const vector = new Map();
  for (const [term, tfValue] of tf.entries()) {
    vector.set(term, tfValue * inverseDocumentFrequency(term, corpus));
  }
  return vector;
}

/**
 * cosineSimilarity
 * -----------
 * Computes cosine similarity between two sparse TF-IDF vectors.
 *
 * @param {Map<string, number>} vectorA - First vector.
 * @param {Map<string, number>} vectorB - Second vector.
 * @returns {number} Similarity score from 0 to 1.
 */
function cosineSimilarity(vectorA, vectorB) {
  let dot = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (const [term, valueA] of vectorA.entries()) {
    const valueB = vectorB.get(term) || 0;
    dot += valueA * valueB;
    magnitudeA += valueA * valueA;
  }
  for (const valueB of vectorB.values()) {
    magnitudeB += valueB * valueB;
  }

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
}

/**
 * extractKeywords
 * -----------
 * Extracts top keywords from text ranked by TF-IDF score.
 *
 * @param {string} text - Source text to analyze.
 * @param {number} topN - Number of top keywords to return.
 * @returns {string[]} Top-ranked keyword list.
 */
export function extractKeywords(text, topN = 8) {
  const tokens = tokenize(text);
  if (!tokens.length) {
    return [];
  }
  const corpus = [tokens];
  const tfIdf = buildTfIdfVector(tokens, corpus);
  return [...tfIdf.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([term]) => term);
}

/**
 * scoreNodeRelevance
 * -----------
 * Scores one node against query text using cosine similarity on TF-IDF vectors.
 *
 * @param {Object} node - Stored context node.
 * @param {string} queryText - Incoming user query.
 * @returns {number} Similarity score in range 0 to 1.
 */
export function scoreNodeRelevance(node, queryText) {
  const nodeText = `${node.compressed || ''} ${(node.keywords || []).join(' ')}`;
  const nodeTokens = tokenize(nodeText);
  const queryTokens = tokenize(queryText);
  const corpus = [nodeTokens, queryTokens].filter((tokens) => tokens.length);

  if (!corpus.length) {
    return 0;
  }

  const nodeVector = buildTfIdfVector(nodeTokens, corpus);
  const queryVector = buildTfIdfVector(queryTokens, corpus);
  return cosineSimilarity(nodeVector, queryVector);
}

/**
 * findTopNodes
 * -----------
 * Returns the highest relevance nodes for a new prompt.
 *
 * @param {Object[]} nodes - Candidate nodes from the current conversation tree.
 * @param {string} queryText - Incoming user prompt text.
 * @param {number} topK - Maximum nodes to return.
 * @returns {Object[]} Top nodes sorted by descending relevance.
 */
export function findTopNodes(nodes, queryText, topK = 2) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return [];
  }

  return [...nodes]
    .map((node) => ({ node, score: scoreNodeRelevance(node, queryText) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, topK))
    .map((entry) => entry.node);
}
