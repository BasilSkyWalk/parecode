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
