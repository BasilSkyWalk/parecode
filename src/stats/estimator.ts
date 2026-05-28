/**
 * Basic heuristic for estimating token count of a string.
 */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

/**
 * Estimates the total token count of a batched search result,
 * including both the content of the matches and the JSON envelope overhead.
 */
export function estimateSearchEnvelopeTokens(
  matches: Array<{ content?: string; estimatedTokens?: number }>,
  errors?: Array<{ pattern: string; detail: string }>,
): number {
  let perMatchTokens = 0;
  
  // Calculate tokens for the actual content
  for (const m of matches) {
    if (m.content) {
      perMatchTokens += estimateTokens(String(m.content));
    } else if (typeof m.estimatedTokens === "number") {
      perMatchTokens += m.estimatedTokens;
    }
  }

  // Create an envelope without the content to measure overhead
  const envelopeMatches = matches.map((m) => {
    const { content, estimatedTokens, ...rest } = m;
    return { ...rest, content: "" };
  });

  const envelope = {
    status: "success",
    matches: envelopeMatches,
    ...(errors && errors.length > 0 ? { errors } : {}),
  };

  const envelopeTokens = estimateTokens(JSON.stringify(envelope));
  return perMatchTokens + envelopeTokens;
}
