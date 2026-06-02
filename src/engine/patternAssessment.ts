import { SessionMemory } from "./sessionMemory.js";

export interface PatternAssessment {
  kind: "pattern_directory_collision" | "pattern_too_short" | "prior_overflow_recurrence";
  pattern: string;
  detail: string;
}

export function assessPatterns(
  patterns: string[],
  availableDirectories: string[],
  history: SessionMemory
): PatternAssessment[] {
  const assessments: PatternAssessment[] = [];
  
  for (const pattern of patterns) {
    // 1. pattern_directory_collision
    const lowerPattern = pattern.toLowerCase();
    for (const dir of availableDirectories) {
      // e.g. "MiniGames" contains "MiniGame"
      const dirName = dir.split(/[/\\]/).pop() || dir;
      if (dirName.toLowerCase().includes(lowerPattern) && pattern.length >= 3) {
        assessments.push({
          kind: "pattern_directory_collision",
          pattern,
          detail: `Pattern "${pattern}" matches directory name "${dirName}". Consider more specific symbols like "${pattern}Service" or "${pattern}Result".`
        });
        break; // one collision per pattern is enough
      }
    }
  }

  return assessments;
}
