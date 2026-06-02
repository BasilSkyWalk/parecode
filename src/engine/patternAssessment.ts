import { SessionMemory } from "./sessionMemory.js";

export interface PatternAssessment {
  kind: "pattern_directory_collision" | "pattern_too_short" | "prior_overflow_recurrence";
  pattern: string;
  detail: string;
}

export function assessPatterns(
  patterns: string[],
  paths: string[] | undefined,
  availableDirectories: string[],
  history: SessionMemory
): PatternAssessment[] {
  const assessments: PatternAssessment[] = [];

  for (const pattern of patterns) {
    const lowerPattern = pattern.toLowerCase();
    for (const dir of availableDirectories) {
      const dirName = dir.split(/[/\\]/).pop() || dir;
      if (dirName.toLowerCase().includes(lowerPattern) && pattern.length >= 3) {
        assessments.push({
          kind: "pattern_directory_collision",
          pattern,
          detail: `Pattern "${pattern}" matches directory name "${dirName}". Consider more specific symbols like "${pattern}Service" or "${pattern}Result".`
        });
        break;
      }
    }

    const cleaned = pattern.replace(/[^A-Za-z0-9_]/g, "");
    if (cleaned.length < 4) {
      assessments.push({
        kind: "pattern_too_short",
        pattern,
        detail: `Pattern "${pattern}" is very short and likely to return too many matches. Consider a more specific symbol.`
      });
    }

    const normalizedPaths = paths && paths.length > 0 ? [...paths].sort().join("|") : ".";
    for (const spill of history.spills) {
      if (!spill.patterns || !spill.paths) continue;
      const spillPaths = spill.paths.length > 0 ? [...spill.paths].sort().join("|") : ".";
      if (spillPaths === normalizedPaths) {
        const overlaps = spill.patterns.includes(pattern);
        if (overlaps) {
          assessments.push({
            kind: "prior_overflow_recurrence",
            pattern,
            detail: `Pattern "${pattern}" with identical paths recently produced an overflow spill at ${spill.path}. Consider narrowing your search.`
          });
          break;
        }
      }
    }
  }

  return assessments;
}
