# parecode

An MCP server that gives coding agents context-window-aware search and safe, atomic multi-file edits — built to cut token usage on large codebases without giving up correctness.

---

## Requirements

- **Node.js 20 or newer** (ESM, native test runner, stable `fetch`-free runtime).
- **[ripgrep](https://github.com/BurntSushi/ripgrep)** on `PATH` (`rg` on Linux/macOS, `rg.exe` on Windows). Install via your package manager:
  - macOS: `brew install ripgrep`
  - Debian/Ubuntu: `apt install ripgrep`
  - Windows: `winget install BurntSushi.ripgrep.MSVC` or `choco install ripgrep`
- A supported MCP client (Claude Code is the reference target).

Parecode does **not** bundle ripgrep — it shells out to the system binary so you stay on a single, audited version.

---

## Install

```sh
npm install -g parecode
```

Pure JavaScript — no native dependencies, no C/C++ toolchain required.

---

## Quick start

Register the server with Claude Code:

```sh
parecode init                       # user scope by default
parecode init --scope project       # commit MCP config to the repo
parecode init --with-hook           # also install a SessionStart hook that nudges Claude to prefer Parecode tools
parecode init --print               # print the equivalent command without running it
parecode init --remove-hook         # remove the SessionStart hook
```

Then in any session, the `ParecodeSearch`, `ParecodeExpand`, and `ParecodeEdit` tools become available. Run `parecode doctor` to confirm registration, hook status, and `.codegraph/` pairing if present.

---

## What it does

- **`ParecodeSearch`** — ripgrep-backed search that returns matches with surrounding context windows in a single call, with per-file byte chunking so large result sets do not blow up your context.
  - `pattern` accepts a single string or an array of strings; arrays dispatch parallel ripgrep runs sharing the same `paths` / `contextLines`, and each match carries a `patterns: string[]` field listing which input patterns contributed. One call replaces N back-to-back greps for related-keyword flow tracing.
  - Overlapping or adjacent windows within the same file are merged automatically (gap ≤ `contextLines`), with bridging lines loaded from disk.
  - Per-match and response-level `estimatedTokens` are returned so the agent can self-budget before consuming results.
  - Opt-in `relatedSymbols: true` surfaces likely event-flow neighbours (`Handle<X>`, `On<X>`, `<X>Handler/Listener/Closed/Completed/Started`) discovered in each match, capped at 10.
  - Omitted line ranges are reported so the agent can widen with `ParecodeExpand` without re-reading the whole file.
- **`ParecodeExpand`** — widen a known `(file, startLine, endLine)` range with optional `contextBefore` / `contextAfter` padding. Designed as the natural follow-up to a `ParecodeSearch` match. Returns the same `estimatedTokens` shape so the same self-budgeting heuristic applies. Prefer this over a full-file `Read` after locating a line.
- **`ParecodeEdit`** — batched multi-file edits with whitespace-tolerant fuzzy matching (and an opt-in Unicode-lookalike mode), pre/post `stat` conflict detection, and atomic same-directory rename writes. Cross-file edits run in parallel.
- **`parecode stats`** — local JSONL session log with token-saved estimates. Zero network. Zero telemetry.

---

## Privacy

Parecode performs **no network calls at runtime**. Session logs are written to your OS data directory (resolved via [`env-paths`](https://github.com/sindresorhus/env-paths)) with `0600` permissions on Unix. Prune with `parecode prune <days>` or wipe the data dir.

---

## License

[MIT](LICENSE)
