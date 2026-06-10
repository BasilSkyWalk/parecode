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

## [0.7.1] — 2026-06-10

Response-token diet. Typical exact-match edit responses shrink ~90%, search responses ~35%; no tool I/O schema break (the trimmed fields were always optional).

### Changed
- Tool responses are serialized as compact JSON (no indentation), cutting response tokens roughly a third on typical search payloads.
- `ParecodeEdit` op results no longer echo `matchedText` and `confidence` on exact-match successes — they repeated the `oldString` the model just sent, and every echoed byte re-enters context on each later turn. Both fields still appear on fuzzy-resolved ops (alongside `usedFuzzy`), where they are diagnostic.

### Fixed
- When a file's content is dropped for exceeding the per-file inline cap, its `lineRanges` is now emptied instead of duplicating `omittedLineRanges`. This also stops session memory from recording dropped windows as returned, which previously made identical follow-up searches come back as `reference` placeholders for content the model had never seen.

## [0.7.0] — 2026-06-10

Fuzzy edit safety. Every change closes a path where `ParecodeEdit` could corrupt a file while reporting success; expect a small uptick in fail-closed retries (`fuzzy_match_failed` / `snippet_mismatch`) in exchange. No tool I/O schema break — new response fields are additive.

### Added
- `ParecodeEdit` per-op results and session stats now report fuzzy usage: `usedFuzzy` on each op result, plus `fuzzyResolved`, `fuzzyFailed`, `snippetMismatches`, and `minFuzzyConfidence` in the recorded stat event. Additive only; fields are omitted or `undefined` when fuzzy was not involved.

### Changed
- Fuzzy matching no longer accepts a flat 0.85 confidence ratio. Beyond whitespace normalization it tolerates at most ~5% character drift, so short `oldString`s must match exactly after whitespace is ignored. Previously `const b = 1;` would happily rewrite `const a = 1;`; now that fails closed with `fuzzy_match_failed`.
- Fuzzy matching now detects ambiguity. When the whitespace-normalized `oldString` (or a drifted line anchor) matches more than one location, the op errors out (`Multiple fuzzy matches found`) or returns `snippet_mismatch` instead of silently editing the first occurrence.

### Fixed
- Drifted `replaceLines` ranges no longer collapse to the anchor span. The relocated range keeps its original length and the last-line anchor is re-verified at the new position, so a stale line number can no longer leave orphaned lines of the old range behind while reporting success at confidence 1.0.
- Fuzzy string patches no longer mangle indentation. When `oldString`'s remembered indentation differs from the file (deeper indent, tabs vs spaces), the replacement adopts the file's actual indentation instead of stacking both; a trailing-newline `oldString` no longer injects a blank line.
- `insertAfter` anchor relocation now resolves to the line where the anchor starts rather than where the match ends.

## [0.6.3] — 2026-06-04

### Changed
- `ParecodeEdit` tool description rewritten to steer the model toward line-range ops (`replaceLines`/`insertAfter` guarded by an `expect` anchor) when target line numbers are known — e.g. the line numbers `ParecodeSearch` returns — and to reserve `oldString` for edits with no known lines. A line number plus a short anchor skips constructing exact-match snippets, so recurring text no longer triggers multiple-match errors and the retries `oldString` needs extra context to avoid. Description-only change; no tool I/O schema change.

## [0.6.2] — 2026-06-03

### Changed
- Published tarball no longer ships compiled test files. `npm run build` now uses `tsconfig.build.json`, which excludes `src/**/*.test.ts` from emit, so `dist/**/*.test.js` is gone from the package. Type-checking (`tsc --noEmit`) still covers tests via the root `tsconfig.json`. No runtime behavior change.

## [0.6.1] — 2026-06-03

### Fixed
- Plugin bundle version is back in lockstep with the package version. `0.6.0` shipped with `plugins/claude-code/.claude-plugin/plugin.json` still at `0.5.2`, which left the bundled plugin's upgrade-detection version stale; both are now `0.6.1`.

## [0.6.0] — 2026-06-03

Session Memory & Pattern Quality. All changes are additive to the v0.5 I/O schema; new response fields are omitted when not applicable, so existing consumers are unaffected.

### Added
- Session memory: a transient per-session record (`sessions/<id>.json` under the data dir) of returned windows, spills, and pattern warnings. Deleted on session end / `parecode prune`; never crosses sessions; no network.
- Cross-call window dedup: a window already returned earlier in the same session comes back as a `kind: "reference"` placeholder (file + line ranges + a note) instead of repeating its content. Re-fetch with `ParecodeExpand` when needed.
- `kind` discriminator now always present on `matches[]` items (`"match"` | `"reference"`) for forward compatibility.
- Pattern pre-flight warnings on `ParecodeSearch` (advisory only, never blocks): `pattern_directory_collision`, `pattern_too_short`, and `prior_overflow_recurrence`, surfaced via the new `warnings` field and `ToolHost.log`.
- Top-K `summary` field on `ParecodeSearch` results when `matches.length > 10`, listing the heaviest matches by estimated tokens.
- Parecode-owned spill path: when a `ParecodeSearch` result exceeds `SPILL_TOKEN_THRESHOLD` (20,000 estimated tokens), the full result is written to a `parecode-spill-*.json` file under the session data dir, the spill is recorded in `sessionMemory.spills`, and the response returns `status: "spilled"` with `spillPath`, `instructions`, and a top-K `summary` instead of the bulky `matches` array. Preempts the host's own response truncation so the spill path is known to Parecode. See [ADR 0007](docs/adr/0007-parecode-owned-spill.md).
- Spill lifecycle: a prior spill is marked consumed when a later `ParecodeExpand` or `ParecodeSearch` targets its path; an unconsumed spill older than 30s surfaces a `spillReminder` on the next response.
- Stats counters `windowsDedupedAcrossCalls` and `spillsUnconsumed`, surfaced in `parecode stats` and `parecode stats --retroactive` (latter marked `(est)`).
- `parecode doctor` reports session-memory location and counts; `parecode doctor --reset` clears session-memory files; `parecode prune` GCs stale `sessions/<id>.json` files with no live process.
- Two sentences to the `ParecodeSearch` tool description covering reference behavior and the `warnings` nudge.

### Changed
- `stats/estimator.ts` subtracts reference-block content from "tokens saved" so cross-call dedup is not double-credited.

## [0.5.2] — 2026-05-31

### Added

- `mcpName` (`io.github.BasilSkyWalk/parecode`) in `package.json` and a root `server.json`, enabling publication to the official [MCP Registry](https://registry.modelcontextprotocol.io). Metadata only — no runtime, tool-schema, or behavior changes.

## [0.5.1] — 2026-05-31

### Added

- `glama.json` server manifest at the repo root and a Glama quality-badge placeholder in the README, for listing on the [Glama](https://glama.ai) MCP directory.

### Changed

- Rewrote the `ParecodeSearch`, `ParecodeExpand`, and `ParecodeEdit` tool and parameter descriptions for clarity, usage guidance, and Glama tool-definition quality. Documentation only — no tool names, input schemas, or output shapes changed.

## [0.5.0] — 2026-05-30

### Changed

- **Breaking I/O Schema Change (Wire-Format Compaction):** Pareto-improving break to address the 27% token overhead observed in Unity A/B tests. New compact shapes are now the defaults.
- **`ParecodeEdit` Line-Range Mode:** The primary path is now line-based rather than whole-string-based. `edits[]` now supports `replaceLines: [start, end]` and `insertAfter: N` operations. Both require an `expect: string` anchor (trimmed first/last line of the target) to verify the state before mutation. String-patching remains as a fallback (`oldString`/`newString`).
- **`ParecodeEdit` Atomicity:** Per-file edits are now truly atomic. If *any* op in a file fails resolution or `expect` verification, that file is left untouched and a `snippet_mismatch` status is reported per op. Previously, mid-file failures could leave a file partially applied.
- **`ParecodeSearch` Brief Default:** Results larger than **2 KB** (total content) now omit match windows by default, returning only locations (`lineRanges` and a new `hits: {line, matchText}[]` array). Callers widen specific regions via `ParecodeExpand`. Results under the threshold continue to auto-inline full context.
- **Envelope Trimming:** Dropped `recommendation` prose and per-match `estimatedTokens` from search results. Tool descriptions in the system prompt have been trimmed from ~1KB to ~5 lines each to save session-start tokens.

### Added

- **`snippet_mismatch` status**: Reported by `ParecodeEdit` when a line-range anchor does not match the file content.

## [0.4.11] — 2026-05-30

### Fixed

- **Plugin version was pinned at `0.4.0` in `plugins/claude-code/.claude-plugin/plugin.json` and never bumped.** Users on any later CLI release were silently running the 0.4.0 plugin, which is missing the aggressive PreToolUse routing reminder added in 0.4.8/0.4.9. Observed in production: a session with 76 assistant turns made only 3 Parecode tool calls because the model wasn't being steered toward `ParecodeSearch` / `ParecodeEdit`. Plugin version now tracks `package.json` and a new test fails CI on drift.
- **`parecode init` no longer no-ops when a stale plugin is installed.** Previously the install branch short-circuited on `isPluginInstalled`, leaving an old plugin in place forever. Now it parses the installed version, compares to the bundled version, and on mismatch performs an uninstall + reinstall. `parecode doctor` also surfaces a `STALE` note when versions diverge so users can see the drift before it bites.

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
