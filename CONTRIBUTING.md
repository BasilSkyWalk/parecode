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
- **DCO sign-off required** — commit with `git commit -s`. The `DCO` workflow blocks PRs whose non-merge commits are missing a `Signed-off-by:` trailer. See [Developer Certificate of Origin](#developer-certificate-of-origin) below.
- Conventional commits encouraged (`feat:`, `fix:`, `chore:`, `docs:`).
- Tool I/O schema changes are **breaking** — they require a major version bump and a `CHANGELOG.md` entry.
- Tool descriptions in `tools/*.ts` are product surface. Any PR that changes their behavior should re-read them cold and include reviewer attention.

---

## Reporting bugs and proposing features

Use the issue templates. For AST grammar gaps (e.g. a language whose `signatures` mode is wrong), please attach a minimal source file that reproduces the issue.

Security-sensitive reports: see `SECURITY.md` (TBD) or email the maintainers listed in `MAINTAINERS.md`. Please don't open a public issue for vulnerabilities.

---

## Developer Certificate of Origin

Parecode uses the [Developer Certificate of Origin 1.1](https://developercertificate.org/) to track contributor provenance. Every non-merge commit on a PR must carry a `Signed-off-by:` trailer matching the commit author. `git commit -s` adds it; `git rebase HEAD~N --signoff` retroactively signs the last N commits.

By adding a sign-off you certify the following:

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

