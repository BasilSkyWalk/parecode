export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

export function estimateSearchEnvelopeTokens(
  matches: Array<{ content?: string; estimatedTokens?: number }>,
  errors?: Array<{ pattern: string; detail: string }>,
): number {
  let perMatchTokens = 0;

  for (const m of matches) {
    if (m.content) {
      perMatchTokens += estimateTokens(String(m.content));
    } else if (typeof m.estimatedTokens === "number") {
      perMatchTokens += m.estimatedTokens;
    }
  }

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
  return lines * 10;
}
