# AGENTS.md

Family meal planning Discord bot. Spec: `docs/SPECS.md`. Decisions and design: `docs/PLAN.md` (section 0 overrides the rest). Work list: `docs/TODO.md`.

## Commands

Run `nvm use` first (Node 26, see `.nvmrc`).

- `npm test`: vitest, all tests
- `npm run typecheck`: tsc, no emit
- `npm run lint`: eslint
- `npm run format` / `npm run format:check`: prettier
- `npm run dev`: run with tsx watch (reads `.env`)
- `npm run build && npm start`: compiled run

A slice is done when test, typecheck, lint and format:check all pass, followed by a commit.

## Layout

- `src/main.ts`: composition root. The only place that wires real clients.
- `src/config/`: env (zod) and, later, Config tab parsing.
- `src/lib/`: logger, correlation context, clock, time, errors and other generic helpers.
- `src/domain/`: pure logic (state machine, ledger, rendering). No I/O.
- `src/clients/<name>/`: one interface + real implementation + fake per external service.
- `src/planner/`, `src/state/`, `src/flows/`, `src/discord/`, `src/scheduler/`: see PLAN.md section 5.
- `test/`: mirrors `src/`. Fixtures in `test/fixtures/`.

## Conventions

- TypeScript strict, ESM, Node 26. Relative imports use the `.js` extension.
- Dates and times use the global `Temporal` API. Never use `Date` for logic. All "now" comes from an injected `Clock`. All date math happens in the Config timezone through `src/lib/time.ts`.
- Flows depend on client interfaces, never on googleapis, discord.js or the Anthropic SDK directly.
- Errors: throw `AppError` with a code. User-facing failures post `funErrorMessage(correlationId)` and log the stack with the same ID.
- Logging: pino through `createLogger`. Wrap each handler or run in `withCorrelation`. Never log secrets. Keys named token, apiKey or authorization are redacted.
- Secrets live only in `.env` (never in the sheet, code or logs). Never read or print `.env` or `secrets/`.
- Comments are sparse: only for non-obvious behavior.

## Testing rules

- Tests never call real APIs (Discord, Google, Anthropic). Use the fakes and recorded Claude fixtures.
- Use `FakeClock` for anything time-dependent.
- Manual checks against real dev services happen only when a TODO item says so.
