# Phase 11, second wave — common rules (read after COMMON.md)

The first wave (packages A–E: value lists, linked choices, formulas, stock on steps, record types) is **merged**
into the main branch and passes lint, typecheck, the whole suite (70 files, 482 tests) and the build. You build
one package of the second wave on top of it, in your own checkout. Everything in `COMMON.md` still binds you
(checkout rules, commits, databases, ports, done means, hand-over), with these differences:

- Your checkout is an **existing worktree with a fresh branch** cut from the merged main branch. `node_modules`
  and `.env` are already there. First run `npx prisma generate` and `npx prisma migrate deploy` (dev DB), because
  the merge added tables. Your database letter and ports are in your prompt (they are the checkout's old ones).
- Read the first wave's hand-over notes for the parts you build on: `docs/phase11/README.md` (contracts and the
  "After the merge" section), and `A-lists.md`, `B-links.md`, `C-formulas.md`, `D-stock.md`, `E-records.md`.
- Strings go in `apps/web/src/locales/parts/<your-feature>.{en,hi}.json` (never in `en.json` / `hi.json`).
- A new npm package needs a reason and must be pinned to a release at least two weeks old (decision 44). Prefer
  what the repo already has (pdfmake for PDF, the records module's Excel writer for .xlsx, the small SVG charts
  of the CRM screens).
- Files other second-wave packages own are named in each brief; a one-line addition to a shared file (`app.ts`,
  `router.tsx`, `nav.ts`, shared `index.ts`, `scope.ts`, `forms/index.ts`) is fine — add the line, change
  nothing else, and list it in your hand-over.
- Hand-over file: `docs/phase11/<LETTER>-<name>.md`.
