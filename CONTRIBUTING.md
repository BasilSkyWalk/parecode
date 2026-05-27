# Contributing to parecode

Thanks for your interest. Parecode is a small, opinionated MCP server; the contribution bar is "matches the design and earns its complexity."

Before opening a PR, please read [CLAUDE.md](CLAUDE.md) — it's the engineering guide for this repo and the rules apply to humans too.

---

## Ground rules

- **Read the spec first.** [docs/superpowers/specs/2026-05-27-parecode-design.md](docs/superpowers/specs/2026-05-27-parecode-design.md) is authoritative. Behavioral changes that diverge from the spec need an ADR in `docs/adr/` first.
- **One concern per PR.** Squash-merge is the default.
- **No new dependency** when the standard library works.
- **Zero network at runtime.** This is enforced in CI; install-time prebuild downloads are the only exception.
- **No telemetry, ever.**

---

## Dev setup

```sh
git clone https://github.com/<org>/parecode
cd parecode
npm install
npm run build      # tsc → dist/
npm test           # vitest
npm run lint       # eslint + prettier check
```

Node 20+ and ripgrep (`rg`) on `PATH` are required — same as for end users.

---

## Architecture

Strict downward layering — `cli/ → adapters/ → engine/ → stats/ → infra/`. Dependencies point down only. Engines take a `ToolHost`; no direct `fs`, `child_process`, or `process.env` in `engine/`. See [CLAUDE.md §1](CLAUDE.md#1-architecture) for the full rules.

If you need a new capability in an engine, extend `ToolHost` — don't reach around it.

---

## Tests

- vitest, colocated `*.test.ts`.
- **No FS mocks in `EditEngine`.** Use real temp dirs (`tmp-promise`).
- Coverage floors: engines ≥ 90% lines, CLI ≥ 70%.
- Snapshot tests for AST output and `parecode stats`.
- Property tests (`fast-check`) for fuzzy match + edit round-trips.

CI runs `{macOS, Linux, Windows} × Node {20, 22}`. A PR that's green locally on macOS but red on Windows is not done.

---

## Commits and PRs

- Branches: `feat|fix|chore|docs/<short>`.
- **DCO sign-off required** — commit with `git commit -s`. PRs without sign-off are blocked.
- Conventional commits encouraged (`feat:`, `fix:`, `chore:`, `docs:`).
- Tool I/O schema changes are **breaking** — they require a major version bump and a `CHANGELOG.md` entry.
- Tool descriptions in `tools/*.ts` are product surface. Any PR that changes their behavior should re-read them cold and include reviewer attention.

---

## Reporting bugs and proposing features

Use the issue templates. For AST grammar gaps (e.g. a language whose `signatures` mode is wrong), please attach a minimal source file that reproduces the issue.

Security-sensitive reports: see `SECURITY.md` (TBD) or email the maintainers listed in `MAINTAINERS.md`. Please don't open a public issue for vulnerabilities.

