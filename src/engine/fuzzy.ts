export function getLevenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

export type FuzzyMatchResult = {
  matchedText: string;
  startIndex: number;
  endIndex: number;
  confidence: number;
};

export function findFuzzyMatch(
  content: string,
  search: string,
  aggressive: boolean = false
): FuzzyMatchResult | null {
  const getNormalized = (str: string, isAggressive: boolean) => {
    const map: number[] = [];
    let normStr = "";
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if (/\s/.test(char)) continue;
      if (isAggressive && /[\u0300-\u036f]/.test(char)) continue;

      let norm = char;
      if (isAggressive) {
        norm = char.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
      }
      
      for (let j = 0; j < norm.length; j++) {
        normStr += norm[j];
        map.push(i);
      }
    }
    return { normStr, map };
  };

  const { normStr: normalizedSearch } = getNormalized(search, aggressive);
  if (normalizedSearch.length === 0) {
    return null;
  }

  const { normStr: normalizedContent, map: indexMap } = getNormalized(content, aggressive);

  let bestMatch: FuzzyMatchResult | null = null;
  let highestConfidence = 0;

  const getEndIndex = (lastMatchedIndex: number) => {
    let endOriginalIndex = indexMap[lastMatchedIndex] + 1;
    while (endOriginalIndex < content.length) {
      const nextChar = content[endOriginalIndex];
      if (aggressive && /[\u0300-\u036f]/.test(nextChar)) {
        endOriginalIndex++;
      } else if (/[\uDC00-\uDFFF]/.test(nextChar)) {
        endOriginalIndex++;
      } else {
        break;
      }
    }
    return endOriginalIndex;
  };

  const exactIndex = normalizedContent.indexOf(normalizedSearch);
  if (exactIndex !== -1) {
    const startOriginalIndex = indexMap[exactIndex];
    const endOriginalIndex = getEndIndex(exactIndex + normalizedSearch.length - 1);
    return {
      matchedText: content.substring(startOriginalIndex, endOriginalIndex),
      startIndex: startOriginalIndex,
      endIndex: endOriginalIndex,
      confidence: 1.0,
    };
  }

  const searchLen = normalizedSearch.length;
  const windowSizes = [searchLen, searchLen + 1, searchLen - 1, searchLen + 2, searchLen - 2].filter(s => s > 0);

  for (let i = 0; i <= normalizedContent.length - Math.min(...windowSizes); i++) {
    for (const size of windowSizes) {
      if (i + size > normalizedContent.length) continue;
      
      const windowStr = normalizedContent.substring(i, i + size);
      const distance = getLevenshteinDistance(normalizedSearch, windowStr);
      const maxLen = Math.max(normalizedSearch.length, windowStr.length);
      const confidence = maxLen === 0 ? 0 : 1 - distance / maxLen;

      if (confidence > highestConfidence) {
        highestConfidence = confidence;
        const startOriginalIndex = indexMap[i];
        const endOriginalIndex = getEndIndex(i + size - 1);
        bestMatch = {
          matchedText: content.substring(startOriginalIndex, endOriginalIndex),
          startIndex: startOriginalIndex,
          endIndex: endOriginalIndex,
          confidence,
        };
      }
    }
  }

  if (bestMatch && bestMatch.confidence >= 0.85) {
    return bestMatch;
  }

  return null;
}
