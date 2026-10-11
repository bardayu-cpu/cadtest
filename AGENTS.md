# Instructions for coding agents (Codex)

## Source of truth
- Full spec: `docs/SPEC.md`. Read it before starting any task.
- Each task is a GitHub Issue. Do exactly that issue's scope; don't start the next one.

## Workflow
1. Create a branch `issue-<number>-<short-name>` from `main`.
2. Implement, then run `npm run lint`, `npm run typecheck`, `npm test` — all must pass.
3. Open a PR titled `#<number> <issue title>`, body starting with `Closes #<number>`, plus:
   - what was done
   - how each acceptance criterion in the issue was checked
   - anything left out, and why
4. A reviewer will comment on the PR. Fix review comments on the same branch.

## Conventions
- TypeScript strict mode. No `any` unless commented why.
- All lengths in the data model are millimetres (mm). Three.js scene: 1 unit = 1 metre. Convert only in `src/geometry/units.ts`.
- Pure geometry logic goes in `src/geometry/` and must have Vitest tests.
- UI text in Chinese; code, identifiers and comments in English.
- Any decision not covered by the spec: pick the simpler, replaceable option and add one line to `DECISIONS.md`.

## Hard rules
- Never commit API keys or `.env*` files (except `.env.example`).
- Do not add analytics/telemetry SDKs.
- Do not call any external AI service until Phase 3; use the `mock` provider.
- Test fixtures live in `fixtures/` (public sample floor plans, OK to commit).
