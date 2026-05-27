# parecode

An MCP server that gives coding agents AST-aware search and safe, atomic multi-file edits — built to cut token usage on large codebases without giving up correctness.

> **Status:** pre-M0. The package name is reserved; the implementation is in active development.

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

Install footprint: **under 30 MB** including prebuilt `node-tree-sitter` grammars for `{darwin-arm64, darwin-x64, linux-x64, win32-x64} × Node {20, 22}`. If no prebuild matches your platform, install falls back to a source build (requires a C/C++ toolchain).

---

## Quick start

Register the server with Claude Code:

```sh
parecode init                 # user scope by default
parecode init --scope project # commit MCP config to the repo
parecode init --print         # print the command without running it
```

Then in any session, the `ParecodeSearch` and `ParecodeEdit` tools become available.

---

## What it does

- **`ParecodeSearch`** — ripgrep-backed search that can return AST signatures (names, parameters, return types, docstrings) instead of full file bodies, dramatically lowering token cost on large files.
- **`ParecodeEdit`** — batched multi-file edits with whitespace-tolerant fuzzy matching, pre/post `stat` conflict detection, atomic same-directory rename writes, and per-language post-write syntax validation.
- **`parecode stats`** — local JSONL session log with token-saved estimates. Zero network. Zero telemetry.

---

## Privacy

Parecode performs **no network calls at runtime**. Session logs are written to your OS data directory (resolved via [`env-paths`](https://github.com/sindresorhus/env-paths)) with `0600` permissions on Unix. Prune with `parecode prune <days>` or wipe the data dir.

---

## License

[MIT](LICENSE)
