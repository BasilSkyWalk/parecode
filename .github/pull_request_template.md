## Summary

<!-- One or two sentences. What changes and why. Link the issue or spec section. -->

## Type of change

- [ ] Bug fix
- [ ] Feature
- [ ] Refactor / chore
- [ ] Docs only
- [ ] Tool I/O schema change (requires major bump + CHANGELOG)

## Checklist

- [ ] Tests added or updated (engines ≥ 90% lines, CLI ≥ 70%)
- [ ] `npm run build`, `npm test` all green locally
- [ ] Tool descriptions in `tools/*.ts` re-read cold if behavior changed
- [ ] `CHANGELOG.md` updated under the next release heading
- [ ] Docs updated (`README.md`, `docs/`, ADR added if architectural)
- [ ] No new runtime network calls (zero-network invariant)
- [ ] No new `utils/` or `helpers/` dumps; no DI container; no v2 feature flags
- [ ] Commits are DCO signed-off (`git commit -s`)

## Notes for reviewer

<!-- Edge cases, trade-offs, follow-up work, screenshots of CLI output, etc. -->
