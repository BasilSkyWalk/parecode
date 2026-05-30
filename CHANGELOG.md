# Changelog

All notable changes to `parecode` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Tool I/O schema breaks bump the major version and require an entry under
**Changed** or **Removed** describing the migration path.

## [Unreleased]

### Added
### Changed
### Deprecated
### Removed
### Fixed
### Security

## [0.4.10] — 2026-05-30

### Added

- **`parecode envelope`** — new CLI subcommand summarizing per-tool-call response sizes and durations from a new ground-truth envelope log (`<dataDir>/envelope.jsonl`). Every MCP tool call now records `bytesReturned` and `durationMs` keyed by tool name and session id. Pass `--since 7d` to filter, `--json` for machine output. Foundation for A/B benchmarking Parecode against native Grep+Read.
- **`parecode tokens`** — new CLI subcommand summarizing Claude Code session token totals (`input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens`) read directly from `~/.claude/projects/*/*.jsonl` transcripts. Per-assistant-turn usage is deduplicated by `message.id`. Pass `--since 7d`, `--limit N`, `--json`.

## [0.4.9] — 2026-05-29

### Changed

- **PreToolUse aggressive hook is now installed by default** by `parecode init`. The previous opt-in default produced an install that "worked" (MCP visible, soft directive present) but in practice models still defaulted to native `Grep` / `Bash grep`, defeating most of the value. Pass `--no-aggressive-hook` to opt out (parallel to existing `--no-hook` / `--no-plugin` flags). The `--aggressive-hook` flag remains a no-op accepted for backward compatibility.
- **`parecode stats` default output is now a lower-bound estimate** rather than the previous upper-bound counterfactual ("model would have Read every matched file in full"). Real model behavior is closer to targeted reads, so the upper-bound number overstated savings by ~3×. Pass `--upper-bound` to see the old number; the `--json` output now emits both `estimatedTokensSavedLowerBound` and `estimatedTokensSavedUpperBound`. A short methodology note is printed by default to keep the framing honest.

## [0.4.8] — 2026-05-29

### Fixed

- PreToolUse hook is now registered as **three separate entries** (`matcher: "Grep"`, `"Glob"`, `"Bash"`) instead of one OR'd entry. Observed in production: Claude Code's matcher does not reliably invoke a hook for `Bash` tool calls when the matcher is the regex alternation `Grep|Glob|Bash`, even though that's valid regex syntax. Three single-tool matchers fire deterministically. Re-running `parecode init --aggressive-hook` migrates an existing combined-matcher entry to the new shape and reports `upgraded`.

### Changed

- `ParecodeEdit` response `detail` field on success is now `"N edits applied"` instead of `"File stat successful: mtimeMs=…, size=…"`. The stat string was diagnostic and consumed ~50 tokens per file in a multi-file batch; the new form is actionable and ~5 tokens.
- `ParecodeSearch` result `omittedLineRanges` is now suppressed when it would contain more than 8 entries (broad searches across long files were emitting 100+ `[start,end]` tuples, dominating the response). The summary field `omittedLines` (total line count) is always emitted when any context was omitted, so the model still knows how much it didn't see — it just doesn't get a wall of range tuples it can't act on.

## [0.4.7] — 2026-05-29

### Fixed

- `parecode init --aggressive-hook` previously wrote `matcher: "Grep|Glob"` into `settings.json`, which meant Claude Code never invoked the hook for `Bash` tool calls — so the shell `grep`/`rg` redirect added in 0.4.6 was dead on arrival for users who had already installed the aggressive hook. The matcher is now `"Grep|Glob|Bash"`, and re-running `parecode init --aggressive-hook` will detect a stale matcher and upgrade the existing hook entry in place (new `upgraded` status reported).

## [0.4.6] — 2026-05-29

### Added

- PreToolUse hook now intercepts shell search commands run via `Bash` (`grep`, `egrep`, `fgrep`, `rg`, `ripgrep`, including piped forms like `cat foo | grep bar`) and redirects them to ParecodeSearch — closes the gap where models bypassed the existing `Grep` / `Glob` redirect by shelling out instead. Substring matches (e.g. `ls /usr/local/lib/grepkit`) are not flagged.

### Changed

- Strengthened the SessionStart directive's rule #1 to explicitly cover (i) shell grep/rg/ripgrep, (ii) the "same file Read at multiple line ranges in one turn" anti-pattern, and (iii) the "Read a whole file just to find a symbol" anti-pattern.

## [0.4.5] — 2026-05-29

### Changed

- Rewrote the SessionStart hook directive (`parecode hook session-start`) to be more directive and skimmable: two numbered rules, an explicit "2+ edits to the same file" trigger for ParecodeEdit, an atomicity argument, and a clearer escape hatch. Addresses observed cases where models with parecode MCP visible still defaulted to sequential `Edit` calls on a single markdown file.

## [0.4.4] — 2026-05-29

### Added

- Bundled ripgrep via `@vscode/ripgrep`. Users no longer need to install ripgrep separately; the correct prebuilt `rg` for their OS/arch is fetched as an optional dependency at install time. `resolveCommand("rg")` prefers the bundled binary and falls back to PATH if unavailable.

## [0.4.3] — 2026-05-29

### Fixed

- `parecode init` on Windows still failed with `spawn EINVAL` on Node 20.12.2+ when invoking `claude.cmd` (CVE-2024-27980 hardening blocks `.cmd`/`.bat` with `shell: false`). `spawnCommand` now invokes `.cmd`/`.bat` via `shell: true` with arguments quoted for `cmd.exe`.

## [0.4.2] — 2026-05-29

### Fixed

- `parecode init` on Windows failed with `spawn claude ENOENT` because `where claude` returns the extensionless npm shell wrapper first, which Node's `spawn` (with `shell: false`) cannot execute. `resolveCommand` now prefers entries matching `PATHEXT` (e.g. `claude.cmd`).

## [0.4.1] — 2026-05-28

### Changed

- `parecode init` now installs the `parecode-explore` Claude Code plugin by default, mirroring the existing default-on behavior of the SessionStart hook. The plugin step soft-fails with a warning (rather than aborting `init`) when the local `claude` build does not support the `plugin` subcommand. Pass `--no-plugin` to skip it; `--with-plugin` remains supported and makes plugin-step failures hard-fail.

### Added

- `parecode init --no-plugin` opt-out flag, parallel to `--no-hook`.
- README section describing the bundled `parecode-explore` plugin and the new default behavior.

## [0.4.0] — 2026-05-28

### Added

- **`parecode-explore` Claude Code plugin**: a read-only exploration agent + skill that delegates "where is X" / "how does Y work" questions to a Haiku-powered sub-agent driven by `ParecodeSearch`. Ships as part of a new `parecode` marketplace (`.claude-plugin/marketplace.json`) at the repo root, with the plugin payload under `plugins/claude-code/`.
- `parecode init --with-plugin`: idempotently adds the `parecode` marketplace (from `https://github.com/BasilSkyWalk/parecode.git`, or the local repo path when `--linked` is set) and installs `parecode-explore@parecode` at the requested scope. Honors `--print` for dry runs.
- `parecode init --remove-plugin`: idempotently uninstalls `parecode-explore` from the requested scope. Leaves the marketplace registered so re-install is a one-step `--with-plugin`.
- `parecode doctor`: new `Plugin Status` row reporting whether `parecode-explore` is installed and at what scope/version.

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [0.3.0] — 2026-05-28

### Added

- `parecode stats --retroactive`: scan your past Claude Code session transcripts (`~/.claude/projects/**`) to see how many tokens Parecode would have saved you. Uses a local JSONL parser and classifier to estimate savings from replaceable Search and Edit calls, plus avoided follow-up Reads.
- `parecode stats --write-snapshot`: optionally save the retroactive scan results to the data directory.
- `parecode doctor`: now checks for the presence of the Claude Code transcripts directory and sniffs the JSONL schema to warn if the format has drifted.
- `parecode init` prints a one-line tip nudging users to run the retroactive scan to see token savings.
- `parecode init --no-hook`: opt out of the SessionStart hook on a per-invocation basis.

### Changed

- **Default install behavior:** `parecode init` now installs the SessionStart hook by default. Previously the hook required `--with-hook`; without it, field cohorts showed near-zero adoption of `ParecodeSearch` / `ParecodeEdit` in main sessions. Pass `--no-hook` to skip the hook (the MCP server is still registered), or `--remove-hook` to remove an already-installed hook. `--with-hook` continues to be accepted as a no-op for backward compatibility. See [ADR 0006](docs/adr/0006-default-on-session-start-hook.md).

### Deprecated

- `parecode init --with-hook` is now a no-op (the behavior it requested is the default). The flag will be removed in a future minor release.

### Fixed

### Security

## [0.2.0] — 2026-05-28

### Added

- `ParecodeSearch`: per-match `estimatedTokens` and response-level `estimatedTokens` so the model can self-budget before consuming results.
- `ParecodeSearch`: `pattern` accepts `string | string[]`. Multiple patterns dispatch parallel ripgrep runs sharing `paths` / `contextLines`. Each match reports a `patterns: string[]` field listing every input pattern that contributed.
- `ParecodeSearch`: overlapping or adjacent windows within the same file are merged automatically (gap ≤ `contextLines`). Bridging lines are loaded from disk; failures abandon the merge and emit unmerged windows with a `warn` log.
- `ParecodeSearch`: opt-in `relatedSymbols: boolean` heuristic surfaces likely event-flow neighbours (`Handle<X>`, `On<X>`, `<X>Handler/Listener/Closed/Completed/Started`) per match, deduped, lexically sorted, capped at 10.
- `ParecodeSearch`: top-level `errors: Array<{ pattern, detail }>` reports per-pattern failures when running multi-pattern; remaining patterns still return.
- `ParecodeExpand`: new tool for widening a known `(file, startLine, endLine)` range with optional `contextBefore` / `contextAfter` padding. Returns `estimatedTokens` in the same form as `ParecodeSearch` so the same self-budgeting heuristic applies to follow-up reads.
- `parecode doctor`: detects `.codegraph/` in the current directory or repo root and prints a hint pairing CodeGraph with parecode where present.

### Changed

- `ParecodeSearch` output gains `patterns` and `estimatedTokens` fields on every match. Single-pattern callers always see `patterns: [theirPattern]` (length 1). Existing v0.1 fields keep their names and types — additive only.

## [0.1.1] — 2026-05-28

### Added

- `ParecodeEdit` now estimates and records native tokens for each edit operation, surfacing them in session logs and `parecode stats` so token-savings figures reflect edits as well as searches.

## [0.1.0] — 2026-05-28

First real release. Ships the v1 surface re-scoped per ADR 0002 (text-level truncation; no AST / tree-sitter), plus initial adoption-hook plumbing per ADR 0003.

### Added

- `ParecodeSearch` MCP tool: ripgrep-backed search returning matches with surrounding context windows in a single call, with `maxBytesPerFile` chunking and `omittedLineRanges` reporting for large result sets.
- `ParecodeEdit` MCP tool: batched multi-file edits with whitespace-tolerant fuzzy matching (`fuzzy: true`) and an opt-in Unicode-lookalike mode (`fuzzy: 'aggressive'`), atomic same-directory writes, and mtime-based concurrency control.
- `parecode init` registers the MCP server with Claude Code. Flags: `--scope {user|local|project}`, `--linked` for locally-linked dev installs, `--print` to dry-run, `--with-hook` to install a `SessionStart` directive nudging the model toward Parecode tools, `--aggressive-hook` to additionally install a `PreToolUse` hook that denies `Grep` / `Glob` and redirects to `ParecodeSearch`, `--remove-hook` to remove all Parecode hook entries.
- `parecode hook session-start` / `parecode hook pre-tool-use` subcommands invoked by Claude Code's hooks runtime.
- `parecode stats` reports session count, tool calls, calls batched, and estimated tokens saved. Now auto-aggregates in-flight `.jsonl` session logs so figures are current without exiting the Claude session. `--since` accepts `d` / `h` / `m` / `s`.
- `parecode prune <days>` deletes old session logs.
- `parecode doctor` reports version, MCP registration, hook status (SessionStart and PreToolUse), data directory size, and ripgrep version.
- `parecode flush` finalizes any in-flight session log into the rollup index.
- `ToolHost.dispatchSubagent` capability stub. The MCP adapter returns `unavailable` for now — engines can branch on the capability today; v2 adapters may wire it to a real model call.
- `ParecodeSearch` returns an optional `recommendation` string when result size exceeds ~4000 tokens, pointing the host model at narrowing the search or dispatching a Haiku subagent.
- `CLAUDE_CONFIG_DIR` and `PARECODE_CLAUDE_CMD` environment variable support in `parecode init` and `parecode doctor` for users whose `claude` CLI is wrapped or runs against a non-default config directory.

### Removed

- AST / tree-sitter processing. Per ADR 0002, the v1 spike showed AST signatures mode produced net-negative token usage once Claude Code's re-fetch behavior was accounted for. `node-tree-sitter`, prebuilt grammars, and the `prebuildify` install matrix are out. v1 is pure JS with no native dependencies.

### Security

- Runtime is zero-network: no telemetry, no version checks. Enforced by `src/infra/noTelemetry.test.ts` and `src/infra/zeroNetwork.test.ts`. Session logs are written to the OS data directory with `0600` permissions on Unix.
