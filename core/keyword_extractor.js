/**
 * ContextPilot v1.0 — keyword_extractor.js
 * --------------------------------
 * TF-IDF keyword scoring + node matching.
 *
 *
 * GitHub: https://github.com/prasadaniket/ContextPilot
 */
// ─── Stop Words ───────────────────────────────────────────────────────────────

// Words that carry no semantic meaning — filtered before scoring
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'it', 'in', 'on', 'at', 'to', 'for', 'of', 'and',
  'or', 'but', 'i', 'you', 'we', 'this', 'that', 'with', 'can', 'how', 'what',
  'my', 'your', 'do', 'did', 'was', 'are', 'be', 'have', 'has', 'had', 'not',
  'so', 'if', 'as', 'by', 'from', 'will', 'would', 'could', 'should', 'may',
  'might', 'just', 'also', 'then', 'than', 'when', 'where', 'who', 'which',
  'there', 'here', 'about', 'up', 'out', 'all', 'some', 'any', 'been', 'more',
  'its', 'they', 'them', 'their', 'our', 'was', 'were', 'into', 'through',
  'get', 'got', 'use', 'used', 'like', 'make', 'made', 'need', 'want', 'know'
]);

// ─── Text Processing ──────────────────────────────────────────────────────────

/**
 * tokenize
 * --------
 * Converts raw text into a cleaned array of meaningful tokens.
 * Lowercases, strips punctuation, removes stop words and short tokens.
 *
 * @param {string} text - raw input text
 * @returns {string[]} array of cleaned tokens
 */
function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')  // strip punctuation
    .split(/\s+/)
    .filter(word => word.length > 2 && !STOP_WORDS.has(word));
}

/**
 * termFrequency
 * -------------
 * Counts how often each token appears in a document.
 * Returns raw counts (not normalized) for cosine similarity use.
 *
 * @param {string[]} tokens - tokenized document
 * @returns {Map<string, number>} token → count map
 */
function termFrequency(tokens) {
  const tf = new Map();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }
  return tf;
}

// ─── Keyword Extraction ───────────────────────────────────────────────────────

/**
 * extractKeywords
 * ---------------
 * Returns the top N most significant keywords from a text block.
 * Uses term frequency (single-document TF) since we don't have a corpus IDF here.
 * Good enough for matching — the node corpus is small (<100 nodes).
 *
 * @param {string} text - input text
 * @param {number} topN - how many keywords to return (default 8)
 * @returns {string[]} array of keyword strings, most significant first
 */
export function extractKeywords(text, topN = 8) {
  const tokens = tokenize(text);
  const tf = termFrequency(tokens);

  return Array.from(tf.entries())
    .sort((a, b) => b[1] - a[1])   // sort by frequency desc
    .slice(0, topN)
    .map(([word]) => word);
}

// ─── Relevance Scoring ────────────────────────────────────────────────────────

/**
 * cosineSimilarity
 * ----------------
 * Computes cosine similarity between two term-frequency maps.
 * Returns a value between 0 (no overlap) and 1 (identical).
 *
 * Formula: dot(A, B) / (|A| * |B|)
 *
 * @param {Map<string, number>} vecA
 * @param {Map<string, number>} vecB
 * @returns {number} similarity score 0–1
 */
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let magA = 0;
  let magB = 0;

  // Dot product: sum of (a_i * b_i) for shared terms
  for (const [term, countA] of vecA) {
    const countB = vecB.get(term) || 0;
    dotProduct += countA * countB;
    magA += countA * countA;
  }

  // Magnitude of B
  for (const [, countB] of vecB) {
    magB += countB * countB;
  }

  const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
  if (magnitude === 0) return 0;
  return dotProduct / magnitude;
}

/**
 * scoreNodeRelevance
 * ------------------
 * Scores how relevant a stored tree node is to the current user query.
 * Compares the node's compressed text + keywords against the query text.
 * Returns a 0–1 similarity score.
 *
 * @param {object} node - stored tree node (must have .compressed and .keywords)
 * @param {string} queryText - the new user prompt
 * @returns {number} relevance score 0–1
 */
export function scoreNodeRelevance(node, queryText) {
  // Build a combined text for the node: compressed summary + keywords boosted
  const nodeText = [
    node.compressed || '',
    // Repeat keywords 2x to give them extra weight in the TF vector
    ...(node.keywords || []),
    ...(node.keywords || [])
  ].join(' ');

  const queryTokens = tokenize(queryText);
  const nodeTokens = tokenize(nodeText);

  const queryVec = termFrequency(queryTokens);
  const nodeVec = termFrequency(nodeTokens);

  return cosineSimilarity(queryVec, nodeVec);
}

/**
 * findTopNodes
 * ------------
 * Scores all nodes against the query and returns the top K most relevant ones.
 * This is the function background.js calls to decide what context to inject.
 *
 * @param {object[]} nodes - all tree nodes for the current conversation
 * @param {string} queryText - the new user prompt
 * @param {number} topK - how many nodes to return (default 2)
 * @returns {object[]} top K nodes sorted by relevance score, highest first
 */
export function findTopNodes(nodes, queryText, topK = 2) {
  if (!nodes || nodes.length === 0) return [];
  if (!queryText || queryText.trim() === '') {
    // No query to match — return the most recent nodes as fallback
    return nodes.slice(-topK).reverse();
  }

  // Score every node
  const scored = nodes.map(node => ({
    node,
    score: scoreNodeRelevance(node, queryText)
  }));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Return only the node objects, top K
  return scored.slice(0, topK).map(({ node }) => node);
}
