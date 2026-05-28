---
name: parecode-explore
description: Use this skill when the user asks exploration questions like "where is X", "how does Y work", or "find all usages of Z"
---

When the user asks you to explore the codebase, find where things are defined, look up usages of a symbol, or explain how a specific component works:

1. **Do not** attempt to answer the question inline.
2. **Do not** use `ParecodeSearch` or other grep tools directly in your current session.
3. **Instead**, you must spawn the `parecode-explore` agent and delegate the entire exploration task to it.

Pass the user's full request to the `parecode-explore` agent. Wait for its response, and then present its findings to the user.
