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
- Do not call any external AI service unless the issue explicitly says so; otherwise use the `mock` provider.
- Test fixtures live in `fixtures/` (public sample floor plans, OK to commit).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
