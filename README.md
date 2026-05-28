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
parecode init                       # user scope; installs MCP + SessionStart hook (default)
parecode init --scope project       # commit MCP config + hook to the repo
parecode init --no-hook             # register MCP only; skip the SessionStart hook
parecode init --with-plugin         # also install the parecode-explore Claude Code plugin
parecode init --print               # print the equivalent command without running it
parecode init --remove-hook         # remove the SessionStart hook (MCP stays registered)
parecode init --remove-plugin       # uninstall the parecode-explore Claude Code plugin
```

The SessionStart hook injects a short directive at the start of each session telling Claude to prefer `ParecodeSearch` / `ParecodeEdit` over the equivalent native tools. Without it, Claude's first-party `Grep` / `Read` / `Edit` tools typically win by default and Parecode's token savings never land. The hook payload is a static string; `parecode hook session-start` prints it. Pass `--no-hook` if you would rather opt in explicitly per session via your own tooling.

Then in any session, the `ParecodeSearch`, `ParecodeExpand`, and `ParecodeEdit` tools become available. Run `parecode doctor` to confirm registration, hook status, and `.codegraph/` pairing if present.

### Optional: the `parecode-explore` plugin

Parecode also ships a Claude Code plugin (bundled in the same npm package) that adds a read-only `parecode-explore` subagent and a matching skill. The agent is pinned to Haiku and is given only `ParecodeSearch`, so exploration-style questions ("where is X?", "how does Y work?", "find all usages of Z") get answered in a cheap, isolated context window instead of burning tokens in your main session.

Install it alongside the MCP server:

```sh
parecode init --with-plugin
```

This registers a local marketplace pointing at the npm-installed copy and runs `claude plugin install parecode-explore@parecode`. Remove it with `parecode init --remove-plugin`. The plugin is optional — Parecode's tools work without it.

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

## Retroactive Savings Scan

Curious how much Parecode would have saved you if you had installed it earlier? You can scan your past Claude Code sessions:

```sh
parecode stats --retroactive --since 30d
```

Sample output:
```text
Parecode — last 30d (retroactive scan)
─────────────────────
Sessions:                   42
Tool calls:                156
Calls batched (est):        89
Tokens saved (est):  1,200,000

* Note: Retroactive savings are estimated, not measured.
```

**Privacy disclaimer:** This scan runs entirely locally against Claude Code's session transcripts (`~/.claude/projects/**`). By default, it parses only structured fields (tool names, paths, patterns, and token counts). It does not send any data over the network. The `--include-content` flag (which allows reading tool input/output) is strictly opt-in and loudly flagged if used.

---

## Privacy

Parecode performs **no network calls at runtime**. Session logs are written to your OS data directory (resolved via [`env-paths`](https://github.com/sindresorhus/env-paths)) with `0600` permissions on Unix. Prune with `parecode prune <days>` or wipe the data dir.

---

## License

[MIT](LICENSE)
