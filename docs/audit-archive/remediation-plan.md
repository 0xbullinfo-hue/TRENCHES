# TRENCHES / TrenchLabs HQ — Consolidated Remediation & Enhancement Plan
## Audit Fixes + User-Facing Improvements (Strict Non-Destructive Edition)

> **PRIME DIRECTIVE — READ FIRST, APPLIES TO EVERY INSTRUCTION BELOW.**
>
> Every change in this plan is **surgical and behavior-preserving**. You MUST NOT distort, delete, refactor-for-style, rename-logic, or alter the behavior of any existing code unless an instruction explicitly authorizes it. Concretely:
>
> 1. **NO logic deletion. No logic rewrite.** Do not touch business rules, calculations, API contracts, validation, auth flows, entitlement logic, Redis/outbox behavior, or wallet flows. If a change would require modifying any of these, STOP and flag it — do not improvise.
> 2. **Class-name substitution ≠ code change.** Renaming a Tailwind class (e.g. `text-toxic` → `text-brand`) or a token value is a string/value replacement only. The rendered output must be pixel-identical unless the instruction explicitly changes a token's hex value.
> 3. **Refactor only with a safety net.** Extracting code (instructions 19, 20) means MOVE code, not rewrite it. The extracted code must be character-for-character identical in behavior. All existing tests must pass before and after, unchanged.
> 4. **No changes to test files**, except where an instruction explicitly says so. If a test asserts on a class name or string you are instructed to change, update the assertion to match the new value — never weaken, skip, or delete the test.
> 5. **Copy changes are scoped to the exact strings in the copy table.** Do not "improve" adjacent copy, comments, or log messages. Comments and log strings are NOT copy and must not be rewritten.
> 6. **One instruction at a time.** Complete, verify (`typecheck` + `lint` + relevant tests), and commit each instruction as its own commit before starting the next. A red build blocks all further work.
> 7. **Nothing is removed without a replacement.** Deleting a token, keyframe, dependency, or patch file is permitted ONLY in the instructions that explicitly order it, and only after a repo-wide grep proves zero remaining usages.
> 8. **If any instruction is ambiguous, STOP and ask. Never guess.**

---

## PHASE 1 — DESIGN TOKENS & PRIMITIVES (Foundation)

1. **Collapse duplicate brand color aliases — VALUE-PRESERVING ONLY.** In `tailwind.config.ts`, alias `toxic`, `pump`, and `accent` to the same underlying values (do not change a single hex in this step). Replace all class usages site-wide via search-and-replace (`text-toxic` → `text-brand`, `bg-toxic-bg` → `bg-brand-bg`, etc.). Do not touch any component logic. Verify: build passes, tests pass, rendered colors identical.
2. **Rename token keys.** Only after instruction 1 is green: remove the old keys (`toxic`, `pump`, `accent`) from `tailwind.config.ts` and `globals.css`. Do not touch `global-error.tsx` copy yet.
3. **Raise muted text to WCAG AA.** Change `muted` `#848E9C` → `#9AA3B2` and `dim` `#8E9BAE` → `#A5AFC0` (tailwind.config.ts + `:root` vars in globals.css). Remove ONLY the `/40` text-opacity at `TierCard.tsx:68` (replace with the token's normal muted value). Do not alter any other opacity usage — visual-scan each changed screen.
4. **Eliminate raw inline hex — TOKEN MAPPING ONLY.** Map `#0d161d` → `bg-surface-card`, `#0d2218` → `bg-brand-bg`, `#1b2533` → `bg-surface-3` in `TelegramStatusBanner.tsx:78` and `TelegramConnectButton.tsx:211,224,250`. Do not restyle anything else in those files. Verify with grep: zero `#[0-9A-Fa-f]{6}` in `.tsx` except inside SVG artwork components (`HexCubeLogo`, `TokenArtwork` — leave untouched).
5. **Delete the `marquee` keyframe and animation** from `tailwind.config.ts`. First grep for `animate-marquee` / `marquee` across `src/`; if zero usages, delete the keyframe. If ANY usage exists, STOP and report — do not remove the usage site without approval.
6. **Remove `framer-motion`** from `package.json` dependencies and run install. First grep `src/` for `framer-motion` imports; expect zero. Do not touch `package-lock.json` manually.
7. **ADD `src/components/ui/Button.tsx`** as a NEW file wrapping the existing `.btn` classes. Do not modify `globals.css` `.btn` definitions. Existing buttons keep working untouched until Phase 2 migrates them. Loading state adds `aria-busy` + spinner with preserved label width — additive only.
8. **ADD `src/components/ui/Card.tsx`** (Card/CardHeader/CardBody/CardFooter) as NEW files. Zero changes to existing components in this step.
9. **ADD `src/components/ui/Tabs.tsx`** implementing the ARIA tabs pattern as a NEW file, plus a unit test proving roles, `aria-selected`, and arrow-key navigation. Zero changes to existing components in this step.
10. **Extend `.chip`/`.chip-active` focus styles** in `globals.css` — ADD `focus-visible:ring-2 focus-visible:ring-brand`. Purely additive to the class definition; no markup changes.
11. **Strengthen `.btn` focus ring** from `ring-1` to `ring-2` + offset in `globals.css` — one class edit only. Visual-check one screen.
12. **Replace Anton with Inter — STYLES ONLY.** Remove the Anton import from `globals.css` and the `fontFamily.display` token. In `HeroTerminal.tsx:82`, change ONLY `font-display uppercase` → `font-sans` with weight 700; do not touch the hero's markup structure, CTAs, or copy (copy changes come in Phase 3, exactly as tabled).

---

## PHASE 2 — LAYOUT, CARDS, TABS & BUTTONS (Mechanical Migration)

13. **Migrate raw `<button>` elements to `Button`** file-by-file, one component per commit. The migration is class-for-class: map each existing variant to the nearest `Button` variant + size; preserve every `onClick`, `disabled`, `title`, `type`, and data-attribute EXACTLY. Do not change behavior, labels, or event handlers. `TierCard.tsx`'s four duplicated class strings collapse into Button usages — the render branches stay identical.
14. **Unify disabled states — VISUAL-ONLY.** Set every disabled button to `disabled:opacity-50 cursor-not-allowed` via the Button primitive. Add the real `disabled` attribute at `TelegramConnectButton.tsx:224` (currently style-only). Do not change WHEN anything becomes disabled — only how it looks.
15. **Convert the dashboard tab bar to the `Tabs` primitive.** Move the existing tab state management (`IncubatorHub.tsx:131` back/forward sync) INTO the Tabs component as props/callbacks — do not delete that logic. Add `min-h` reservation on tab panels to prevent CLS; measure current rendered heights and set min-h to the tallest panel's height.
16. **Standardize radius and padding — CLASS EDITS ONLY.** Cards → 12px, modals → 16px, fix `global-error.tsx:21` (`rounded-2xl`→`rounded-xl`) and `not-found.tsx:59` (`rounded`→`rounded-xl`). Normalize card padding to `p-5 sm:p-6` where it deviates. No structural changes.
17. **Normalize `duration-200` → `duration-150`** via grep-and-replace. Verify each changed component still renders.
18. **Fix fetch race conditions — ADD CANCELLATION, CHANGE NO LOGIC.** Add an `AbortController` in `LedgerGrid.tsx` and `CampaignCard.tsx` fetch paths: abort in-flight on parameter change, ignore stale responses. The request URLs, response handling, state updates, and success paths stay identical. For `LedgerGrid.tsx:76-81`: keep the effect but guard it so it cannot double-fetch; remove the eslint-disable line by fixing the underlying pattern, never by suppressing further.
19. **Extract `CampaignCard.tsx` — MOVE CODE ONLY.** Move submission/signing/fetch logic into `lib/campaigns/` hooks verbatim (character-for-character behavior). The 1,407-line file must end under ~300 lines of presentation. All existing tests for CampaignCard (`tests/unit/campaign_card_component.test.mjs`, `social_raid_submission_ux.test.mjs`) must pass UNCHANGED.
20. **Extract `GenesisContext.tsx` — MOVE CODE ONLY.** Split into `WalletContext` + `AuthContext` preserving every exported symbol and behavior; keep a re-export shim if any consumer would break. No consumer file changes beyond import paths in this step.
21. **Replace the ⚡ emoji** at `HeroTerminal.tsx:69` with `<Zap />` from lucide-react. Class-for-class styling match. No other change to that anchor.

---

## PHASE 3 — COPY, STATES & EDGE CASES

22. **Apply the copy table below — EXACT STRINGS ONLY.** Replace only the cited strings. Do not touch neighboring copy, comments, or logs. Update any test asserting the old strings to assert the new ones — never weaken the test.
23. **Rewrite the global error copy** exactly as tabled (`global-error.tsx`, `error.tsx`). No structural/layout changes to those files beyond the strings.
24. **Rewrite error strings with recovery guidance**, scoped to: `LedgerGrid.tsx:67` (add retry guidance + working retry action using the EXISTING refetch handler) and the `HTTP ${status}` mapping at `LedgerGrid.tsx:57` (map to human copy; do not change error-handling flow).
25. **Replace hover-only tooltips** in `TierCard.tsx:110-114` with the shared `Tooltip` primitive (hover + focus + Escape). The tooltip CONTENT comes from the existing `ctaTooltip` prop — do not invent new content.
26. **Add `aria-label` to icon-only buttons** lacking accessible names (`CopyableCA.tsx`, `SinceCallChip.tsx`) — additive attributes only.
27. **Add `jsx-a11y` to `eslint.config.mjs`.** Run lint; fix ONLY new a11y violations by ADDING attributes/roles — never by removing interactive elements or changing behavior.
28. **Handle the three root `.patch` files.** Do NOT apply or delete them. Move them to `docs/audit-archive/` and note their disposition in this document — deletion requires explicit owner approval.
    - **Disposition Note (2026-11-15):** `trenches-final-production-blocker-fix.patch`, `trenches-market-data-audit.patch`, and `trenchlabs-ui-ux-refinement.patch` were moved from the repository root into `docs/audit-archive/` without being applied or deleted. See `docs/audit-archive/README.md` for full details.

### Copy Refactoring Table (EXACT replacements — change nothing else)

| Location | Current (exact) | Replace With (exact) |
|---|---|---|
| `HeroTerminal.tsx:24-26` | "BUILDING THE STRONGEST COMMUNITY IN THE TRENCHES" | "A research platform for on-chain communities" |
| `HeroTerminal.tsx:30` | "We don't chase chains, we chase trenches. If there's a trench, we're in it." | "TrenchLabs is a research and trading-intelligence platform. Holding GENESIS ($H42) unlocks membership tiers and tools." |
| `HeroTerminal.tsx:43` | "JOIN THE SOFT LAUNCH" | "Get Early Access" |
| `global-error.tsx:28` | "TELEMETRY SYNC INTERRUPTED" | "Something went wrong" |
| `global-error.tsx:32-36` | "Temporary Network Desync" + desync paragraph | "The application encountered an unexpected error. Your data is safe — retry or reload the page." |
| `DashboardStakingCard.tsx:62-64` | "After buying GENESIS on your preferred tier get instant notifications on all calls fast on Telegram. More call Details remain here on dashboard" | "Connect Telegram to receive call alerts instantly. Full call details and history remain on this dashboard." |
| `LedgerGrid.tsx:67` | "Couldn't load the ledger." | "The ledger couldn't be loaded. Check your connection and try again." |
| `TierCard.tsx:105` | `title="LIVE SOON"` | "Available at launch" |

ALL-CAPS rule: sentence-case every ALL-CAPS sentence-length label system-wide EXCEPT single-word status badges (LIVE, FAILED, OPEN). When changing a label that a test asserts, update the test assertion to match.

---

## PHASE 4 — VERIFICATION

29. `npm run typecheck && npm run lint && npm run build` — zero errors. A red build blocks everything.
30. `npm run test && npm run test:e2e && npm run test:browser` — all green; any failure blocks Phase 5.
31. Manual verification: keyboard-only walkthrough of every tab/filter/CTA; viewports 320/768/1440px; `prefers-reduced-motion` smoke test. Record results in `docs/audit-archive/verification-2026-11.md`.
32. Axe (or equivalent) AA contrast scan — zero violations.

---

## PHASE 5 — USER-FACING IMPROVEMENTS (All NEW Code — Zero Existing-Code Modification Except Where Stated)

> Phase 5 is strictly ADDITIVE. New components live in new files. Existing files receive only the minimal integration edit stated per instruction.

33. **PRO unlock progress bar.** ADD a `ProProgressBar` component fed by the EXISTING `gap_to_pro_usd` from `/api/stake/status`. Integration edit: render it on the dashboard overview page only. Do not modify the API.
34. **Watchlist with opt-in alerts.** ADD persistence for pinned tokens and an opt-in toggle per token, wired to the EXISTING `alerts-monitor.ts`/Telegram delivery. Default off. Do not change how alphas render; add only the pin control and a watchlist view.
35. **Ledger methodology explainer.** ADD a dismissible "How this ledger works" panel on the public ledger page, content derived from `src/lib/ledger/` logic. Verify every claim against the code before shipping.
36. **Onboarding checklist.** ADD a dismissible 4-step checklist on first wallet connection (persist per wallet). Must not block the UI; dismissible at any time.
37. **Weekly tier performance digest.** ADD a digest generator reading closed-call ledger data, delivered via the EXISTING Telegram bot + shown in-dashboard. Free tier gets the sanitized variant.
38. **Signal-delay cost comparison.** ADD a sanitized comparison panel on the tier section using tier timing data. No changes to tier logic.
39. **Command palette (⌘K).** ADD a palette component extending the TerminalHeader search pattern; integration edit limited to mounting it in the terminal layout.
40. **Consistent price provenance.** ADD `MarketDataBadge` rendering next to $H42-denominated figures (tier thresholds, stake values, gap-to-pro). Badge component already exists — reuse, do not fork.
41. **Stake transaction status timeline.** ADD a visible timeline (submitted → confirming → verified → active) driven by EXISTING `/api/stake/status` polling; disable the submit control while any step is in progress (duplicate-submission guard). No API changes.
42. **Mobile stake-flow pass.** Adjust `StakeForm.tsx` layout classes ONLY (touch targets, spacing, deep-link return guidance). No changes to the verification flow or signature handling.

---

## DEFINITION OF DONE (whole plan)

- `typecheck`, `lint`, `build`, `test`, `test:e2e` all green with NO test weakened, skipped, or deleted.
- Zero `toxic`/`pump`/`accent` tokens; zero raw hex in `.tsx` (SVG components exempt); zero raw `<button>` outside `src/components/ui/`; zero `duration-200`.
- `git log` shows one commit per instruction — clean rollback points throughout.
- Axe AA clean; keyboard walkthrough recorded at `docs/audit-archive/verification-2026-11.md`.
- Every Phase-5 feature behind its stated opt-in rule.
- This document archived in-repo at `docs/audit-archive/remediation-plan.md`.
