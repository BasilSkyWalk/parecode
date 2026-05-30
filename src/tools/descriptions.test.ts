import { describe, it, expect } from "vitest";
import { ParecodeEditToolSpec } from "./edit.js";
import { ParecodeSearchToolSpec } from "./search.js";
import { ParecodeExpandToolSpec } from "./expand.js";

describe("Tool Descriptions", () => {
  const PARECODE_EDIT_DESCRIPTION_MAX_CHARS = 450;
  const PARECODE_SEARCH_DESCRIPTION_MAX_CHARS = 450;
  const PARECODE_EXPAND_DESCRIPTION_MAX_CHARS = 350;

  it("ParecodeEdit description is compact", () => {
    expect(ParecodeEditToolSpec.description.length).toBeLessThan(PARECODE_EDIT_DESCRIPTION_MAX_CHARS);
  });

  it("ParecodeSearch description is compact", () => {
    expect(ParecodeSearchToolSpec.description.length).toBeLessThan(PARECODE_SEARCH_DESCRIPTION_MAX_CHARS);
  });

  it("ParecodeExpand description is compact", () => {
    expect(ParecodeExpandToolSpec.description.length).toBeLessThan(PARECODE_EXPAND_DESCRIPTION_MAX_CHARS);
  });
});
