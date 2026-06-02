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

/**
 * Estimates the token count of content that was omitted due to deduplication
 * into SearchReference blocks. This prevents double-crediting "tokens saved"
 * for content that was truncated purely due to dedup rather than original
 * text-truncation.
 */
export function estimateReferenceTokens(
  matches: Array<{ kind?: string; lineRanges?: Array<[number, number]> }>
): number {
  let lines = 0;
  for (const m of matches) {
    if (m.kind === "reference" && m.lineRanges) {
      for (const [start, end] of m.lineRanges) {
        lines += Math.max(0, end - start + 1);
      }
    }
  }
  // Rough heuristic: ~40 chars per line on average, 4 chars per token => 10 tokens/line
  return lines * 10;
}
