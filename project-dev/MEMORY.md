# TRENCHLABSHQ.COM — PERSISTENT EXECUTION MEMORY

> Rule: never delete past decisions. Superseded items are struck through / marked `SUPERSEDED` with the replacing decision referenced.

---

## 0. Current Snapshot (read this first)

| Key | Value |
| --- | --- |
| Product | TrenchLabsHQ.COM — multi-chain research incubator, Solana-native |
| Token | `$GENESIS` — SPL token on Solana (`EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump`) |
| Capital rule | ~~**NO STAKING.** Liquid wallet balance only~~ `SUPERSEDED by M23` — **3-Tier System:** `Free` ($0), `Member` ($20 `$GENESIS` held in wallet), `Pro` ($250 `$GENESIS` staked for 90 days on StakePoint pool `159`) |
| Hard gate | Server-resolved entitlements (`src/server/entitlements.ts`): `free` (closed calls only), `member` (open calls + Member Telegram), `pro` (Max Alpha + real-time Telegram signals + TP/SL alerts), `unknown` (fail-closed on price-oracle outage) |
| Routing Architecture | **Strict Separation (v5):** `(public)/page.tsx` (`/` Landing Page Only) + `(terminal)/dashboard/page.tsx` (`/dashboard` Token-Gated Incubator Terminal) + `(terminal)/dashboard/stake/page.tsx` + `/api/alphas`, `/api/tiers/current`, `/api/stake/*`, `/api/telegram/*` |
| Framework | Next.js 16 (`^16.2.4`) App Router + TypeScript (client + API routes) |
| Persistence | Upstash Redis (`src/server/kv.ts`) for calls registry (`trench:alphas:registry:v1`), distributed locks (`trench:alphas:lock`), Telegram subscribers (`tg:subs`), and durable TP/SL notification outbox (`trench:tpsl:outbox:*`) |
| Styling | Tailwind CSS 3, Lucide React, Framer Motion (<200ms) |
| Wallets | `@solana/wallet-adapter-*` (Phantom, Solflare adapters; Backpack via Wallet Standard auto-detect) |
| Local URL | `http://localhost:3000/` (Landing Page) & `http://localhost:3000/dashboard` (User Dashboard) |
| Active phase | M23–M25 — 3-Tier StakePoint Architecture, Durable Upstash Redis TP/SL Outbox & Production Hardening — ✅ COMPLETE |

---

## 1. Environment & Config Contracts

| Var | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SOLANA_RPC` | `https://api.mainnet-beta.solana.com` | Client RPC for wallet adapter + balance reads |
| `SOLANA_RPC` | falls back to `NEXT_PUBLIC_SOLANA_RPC` | Server-side RPC for `/api/alphas?wallet=` verification |
| `NEXT_PUBLIC_GENESIS_MINT` | `EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump` | Official `$GENESIS` SPL mint on Solana |
| `ALLOW_DEMO_BALANCE` | `true` | When `false`, API ignores client-supplied `balance` and requires `wallet` (server-verified) |

---

## 2. Solana Architecture & Route Isolation

- **Cluster:** mainnet-beta.
- **Mint:** `NEXT_PUBLIC_GENESIS_MINT`. Placeholder until the token is live.
- **Balance parsing (client):** Derives ATA via `getAssociatedTokenAddressSync` (`@solana/spl-token`) and queries `connection.getParsedTokenAccountsByOwner(owner, { mint })` → sums `tokenAmount.uiAmount` across accounts. Re-reads on wallet connect/change.
- **Balance parsing (server):** JSON-RPC `getTokenAccountsByOwner` with `{ mint }`, `encoding: jsonParsed`, same summation.
- **Dependency pin:** `@solana/web3.js` pinned to **1.x** (`^1.98.0`).
- **Route Isolation (v3 — Authoritative):**
  ```text
  src/app/
  ├── (public)/                      # Marketing & Public Discovery
  │   ├── page.tsx                   # LANDING PAGE ONLY (Hero, Mascot, Trust Strip, Pipeline, Mechanism & Tier Matrix, Track Record, Community Gateway)
  │   └── layout.tsx                 # Public header (with 28px Live Marquee Ticker + "Launch App" CTA) & Footer
  ├── (terminal)/                    # Authenticated Token-Gated Application Desk
  │   ├── dashboard/
  │   │   └── page.tsx               # DASHBOARD ONLY (Simple 3-Column Trading Terminal Desk / Lockout)
  │   └── layout.tsx                 # Terminal header with Live Marquee Ticker, Balance Indicator, Demo Switcher & Disconnect
  ├── api/
  │   └── alphas/route.ts            # Token-gated alpha data API
  └── layout.tsx                     # Root Solana Wallet Provider wrapper
  ```

---

## 3. Design Tokens (v2/v3 — authoritative)

### Color
| Token | Hex | Use |
| --- | --- | --- |
| `canvas` | `#0A0E13` | page background |
| `surface` | `#11161D` | cards |
| `surface-2` | `#161C24` | rows, inputs, nested blocks |
| `surface-3` | `#1C232D` | hover rows, pressed |
| `line` | `#1E2530` | neutral internal dividers |
| `hairline` | `rgba(124,255,94,0.15)` | card border resting |
| `hairline-hover` | `rgba(124,255,94,0.45)` | card border hover |
| `accent` | `#7CFF5E` | primary CTA, LIVE, positive PnL — used with restraint |
| `ink` | `#EAECEF` | primary text |
| `muted` | `#848E9C` | labels, headers |
| `dim` | `#707A8A` | timestamps, tertiary |
| `amber` | `#F59E0B` | INCUBATING |
| `idle` | `#6B7280` | UPCOMING |
| `danger` | `#F6465D` | lockout / denied |

### Rules
- Radius: `2px` (cards, pills, buttons). Zero rounded-xl consumer shapes.
- **No** box-shadow glows, gradient text, blurred orbs, hover lifts. Depth = color steps + 1px borders.
- **Only glow on the entire site:** mascot beaker liquid (SVG filter scoped strictly to the liquid group inside the flask).
- Grid: 4/8px. Card header strip = 36px, mono 10px uppercase breadcrumb.
- Numbers: `tabular-nums` (`.tnum`) + JetBrains Mono everywhere a figure can change.
- Type: Inter 400/500/600/700 for UI; JetBrains Mono for data. Loaded via `next/font/google`.

---

## 4. Tier Formula

### v5 (3-Tier USD-Indexed + StakePoint Architecture — Current Authoritative)
| Requirement | Tier | Access |
| --- | --- | --- |
| `$0` | `free` | Public landing page, closed calls + P&L ledger, public Telegram channel |
| `$20+ $GENESIS` held in wallet | `member` | Open calls (standard), Member Telegram group, Incubator dashboard access (`5m` delayed Telegram call dispatch) |
| `$250+ $GENESIS` staked for `90 days` on StakePoint (Pool `159`) | `pro` | Everything in Member + Max Alpha (`PRO`) calls, real-time Telegram signals, automated TP/SL push alerts |
| Oracle unreachable (`priceUsd === null`) | `unknown` | Fail-closed: no promotion/demotion, stake confirmation rejected (`503`), Telegram sweep skips evictions |

### v4 (Single-Tier Architecture — `SUPERSEDED by v5`)
| Balance | Tier | Multiplier | Access |
| --- | --- | --- | --- |
| `< 1,000,000 $GENESIS` | LOCKED | — | — (HTTP 403 / Locked Terminal) |
| `1,000,000+ $GENESIS` | Lab Member | 1.0x | Full Lab & All Incubated Alpha Calls |

### v2/v3 (Historical Reference)
| Balance | Tier | Multiplier | Base cap |
| --- | --- | --- | --- |
| `0` | LOCKED | — | — (HTTP 403) |
| `1 – 49,999` | Lab Tech | 1.0x | 2 SOL |
| `50,000 – 149,999` | Researcher | 2.5x | 5 SOL |
| `150,000+` | Lead Chemist | 6.0x | 12 SOL |

---

## 5. API Contract — `GET /api/alphas`

Query: `balance` (number, demo path) **or** `wallet` (base58, server-verified path; takes precedence).

| Case | Status | Body |
| --- | --- | --- |
| missing/invalid params | 400 | `{ ok: false, error: "BAD_REQUEST", items: [] }` |
| balance ≤ 0 | 403 | `{ ok: false, error: "ACCESS_DENIED_ZERO_BALANCE", items: [] }` |
| balance > 0 | 200 | `{ ok: true, tier, tierLabel, multiplier, allocationCap, balance, verified, items[], portfolio, serverTime }` |

---

## 6. Milestone Log

### M1–M10 — Completed (see prior entries) ✅
### M11 — Clean Route Separation (`(public)` vs `(terminal)/dashboard`) ✅
### M12 — Landing Page Architectural & Visual Elevation ✅
### M13 — Official `$GENESIS` Contract (`EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump`) & Tier-Gated Incubator Hub (`/dashboard`) ✅
- **Official Mint Wired:** Set `DEFAULT_GENESIS_MINT = 'EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump'` in `src/lib/config.ts` with `MINT_CONFIGURED = true`, live Solscan/Pump.fun/Jupiter links, and server/client ATA balance verification.
- **Tier-Gated Alpha Registry (`src/server/alphas-data.ts`):** Expanded to 12 curated incubator coins across `Lab Tech (1+ $GENESIS — 4/12 unlocked)`, `Researcher (50,000+ $GENESIS — 8/12 unlocked)`, and `Lead Chemist (150,000+ $GENESIS — 12/12 unlocked)` with custom SVG artwork motifs (`TokenArtwork.tsx`), embedded green sparklines, market caps, holder reward pools, syndicate callers, and tier masking.
- **Incubator Dashboard (`src/components/dashboard/IncubatorHub.tsx` + `AlphaInspectorModal.tsx`):**
  1. Top Search (`⌘K`), Watchlist bar, Verified `$GENESIS` (`EM9M...pump`) contract badge, and instant Balance Tier Simulator (`10K Lab Tech`, `50K Researcher`, `150K Chemist`, `0 Locked`).
  2. Hero Banner + 4-Metric KPI Strip (`$31,477,140` Holder Rewards, `$26,630,094` 24h Vol, Verified `$GENESIS` Balance & Multiplier, Unlocked Alpha Token counter + progress bar).
  3. Live Syndicate Activity Tape (`● LIVE` BUY/SELL/ALLOC/UNLOCK pill stream).
  4. **Top 5 Incubated & Paying Coins** horizontal crown spotlight (`pill`, `baton`, `Big Trench Coin`, `swordcat`, `JubJub`).
  5. **Explore Incubated Alpha Coins** with category pills (`All Alpha`, `Unlocked For Me`, `Movers`, `New`, `Holder Rewards`, `AI & Stealth`, `150K+ Whale Pool`, `Watchlist`), Quick Buy (`0.5 / 1.0 / 2.5 SOL`), Chain filter, Sort dropdown, and **Grid View** (visual artwork + inline green sparklines + tier lock/unlock badges) vs **Table View** toggle.
  6. **Split Leaderboard Panels**: Top Syndicate Callers (`24h`/`7d`) & Top Winning Incubated Coins (`24h`/`7d`) + Portfolio Claims & Telegram Key generator.
- **Diagnosis of `/` Landing Page issues:**
  1. Left hero copy was trapped inside a `.card` box next to the mascot box, making the hero look like two small dashboard widgets instead of a commanding institutional landing stage.
  2. The 28px Live Terminal Marquee was missing from `PublicHeader.tsx`, depriving `/` of live terminal energy.
  3. Typographic scale between section headlines, metrics, and body copy was too uniform (`text-xs` everywhere), creating a flat "wall of tiny boxes" feel.
  4. Needed an interactive **Liquid-Hold Tier & Allocation Simulator** and an institutional **Cross-Chain Incubation Ledger** on `/` to bridge public discovery into `/dashboard`.
- **Upgrades in M12:**
  - `PublicHeader.tsx`: Added the 28px sub-header Live Terminal Marquee strip (`[TX] 0x91...2a claimed 0.5 ETH in $PEPE_TRENCH` • `[NEW INCUBATION DETECTED: SOL CHAIN]` • `[EXP01 BURN: 120,000 $GENESIS BURNED]` • `[SOL TPS: 2,840]`) and refined navigation + `[Launch App →]` CTA.
  - `HeroTerminal.tsx`: Redesigned as a full-bleed architectural split stage on the precision grid canvas with oversized display typography (`text-4xl sm:text-5xl lg:text-[54px]`), copyable `$GENESIS` SPL mint bar, multi-chain coverage badges (`SOL • BASE • ETH • BSC`), and a museum-grade **Containment Unit 01** frame for the Trench Rat mascot, anchored by a full-width 4-metric Institutional Trust Band (`$18.4M+`, `6.8x`, `04 (SOL, BASE, ETH, BSC)`, `< 2% OF APPLICANTS`).
  - `PipelineGrid.tsx`: Elevated the 4-card `EXP01`–`EXP04` matrix with oversized index numerals (`01`–`04`), progress/readiness gauges, structured telemetry tables, and clear status pills.
  - `src/app/(public)/page.tsx`: Added the **3-Step Liquid-Hold Architecture & Interactive Tier Matrix** (`Lab Tech 1.0x`, `Researcher 2.5x`, `Lead Chemist 6.0x` — clickable to preview & launch directly into `/dashboard` at that tier) and the **Verified Multi-Chain Incubation Track Record Table** alongside the Community & Syndicate Gateway.

### M14–M17 — Hero Mascot Image (`trench-rat-hero.jpg`), Read-Only CA/Market Execution, Single `1,000,000 $GENESIS` Tier, and Complete UI/UX Cleanup ✅
- **Hero Stage (`src/components/HeroTerminal.tsx`):**
  - Headline: **`THE STRONGEST COMMUNITY IN THE TRENCHES`**
  - Subtext: *"Building, experimenting, and shipping together. A multi-chain lab running live experiments — $GENESIS is the incubator token, TRENCHLABS is the incubator. We don't chase chains, we chase trenches. If there's a trench, we're in it."*
  - Replaced the `$GENESIS CA` card with a bold primary **`BUY $GENESIS ON PUMP.FUN`** button (`https://pump.fun/coin/EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump`) and placed **2 community buttons directly underneath**: **`JOIN TELEGRAM`** (`https://t.me/TrenchLabsHQ`) and **`FOLLOW ON X`** (`https://x.com/Trenchlabshq`).
  - Integrated `/images/trench-rat-hero.jpg` with `mix-blend-lighten` and radial mask feathering to remove its background box while aligning flush with the 12-column grid and cards below.
  - Updated the 4-Metric Strip (zero `//METRIC_01` slop):
    1. `ALPHA CALLS` | `1+` | `DISTRIBUTED ACROSS INCUBATED LAUNCHES`
    2. `AVG EARLY MULTIPLIER` | `34.8x` | `MEAN PEAK PROFIT FOR $GENESIS HOLDERS`
    3. `CHAINS MONITORED` | `ALL CHAIN` | `TRENCHES HAVE NO CHAIN`
    4. `CURATION RATIO` | `< 2% OF APPLICANTS` | `PRIVATE SYNDICATE VETTED`
- **Incubator Pipeline (`src/components/PipelineGrid.tsx`):**
  - Reveals past early-entry incubator tokens and realized `X` profits (`$PILL 64.2x`, `$BATON 48.5x`, `$BTC 32.0x`, `$SWORDCAT 19.4x`).
- **Single-Tier Architecture (`1,000,000 $GENESIS`) & Combined `JOIN THE LAB` Card (`src/app/(public)/page.tsx`, `src/lib/tiers.ts`, `src/context/GenesisContext.tsx`, `src/server/alphas-data.ts`, `src/app/api/alphas/route.ts`):**
  - Consolidated access into **1 single tier** (`LAB_MEMBER`): all users must hold **`1,000,000 $GENESIS`** (`EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump`) in their login wallet.
  - Combined the 3 cards in `JOIN THE LAB` into **1 unified `1,000,000 $GENESIS` Lab Membership card** and removed the `[Open Incubator Dashboard]` header button.
- **Dashboard Execution Rule (`/dashboard`):**
  - Users cannot buy tokens inside `/dashboard`. All unlocked alpha tokens provide **`COPY CA`** and external **`Open Market`** links (`Pump.fun`, `Photon`, `BullX`, `DexScreener`, `Solscan`).
- **Complete Slop Purge:**
  - Removed all `//...` comment prefixes, `[BRACKET]` button syntax, `SIM` header controls, and `FEED` top marquee strip across the entire codebase.

### M18 — Refactor Design System to Exact Pump.fun Brand Aesthetic ✅
- **Pump.fun Color Spectrum (`tailwind.config.ts` & `src/app/globals.css`):**
  - Primary mint/pill green: `pump.DEFAULT = #55FF99` (RGB: `85, 255, 153`)
  - Soft pill green highlight: `pump.pill = #86EFAC`
  - Hover green: `pump.hover = #43E085`
  - Dim green: `pump.dim = #22C55E`
  - Borders & glow tokens: `pump.border = rgba(85, 255, 153, 0.25)`, `pump.glow = rgba(85, 255, 153, 0.45)`, `pump.bg = rgba(85, 255, 153, 0.12)`
  - Shadows: `shadow-pump-glow = 0 0 15px rgba(85, 255, 153, 0.35)`, `shadow-pump-pill = 0 0 8px rgba(85, 255, 153, 0.2)`
  - Dark surfaces: `canvas = #0A0E13`, `surface = #11161D`, `surface-card = #161C24`, `muted = #848E9C`, `dim = #474D57`
- **Full Codebase Refactor:** Replaced 100% of legacy `#7CFF5E` / `#65E84C` / `#6EE755` greens and mismatched dark backgrounds across `PublicHeader.tsx`, `TerminalHeader.tsx`, `HeroTerminal.tsx`, `PipelineGrid.tsx`, `src/app/(public)/page.tsx`, `Footer.tsx`, `LockedTerminal.tsx`, `MascotRat.tsx`, `IncubatorHub.tsx`, `AlphaInspectorModal.tsx`, `TokenArtwork.tsx`, `src/app/(terminal)/dashboard/page.tsx`, and `src/server/alphas-data.ts`.

### M19 — Merged `JOIN THE LAB` Buy Button, `CONNECT` Header Button, Bottom-Aligned Hero Mascot, and Enlarged Menu Tabs ✅
- **`JOIN THE LAB` Card (`src/app/(public)/page.tsx`):** Removed the `Connect Login Wallet` button and merged the action row into a single full-width primary **`BUY $GENESIS ON PUMP.FUN`** button (`h-14`).
- **Header CTA & Enlarged Menu Tabs (`src/components/PublicHeader.tsx` & `src/components/TerminalHeader.tsx`):**
  - Changed the `Enter App` button to a bold **`CONNECT`** button (`h-11 px-6`).
  - Increased navigation menu tabs (`Home`, `Experiments`, `Community` / `Join The Lab`) to `text-base lg:text-lg font-extrabold` with `px-4 py-2` hit areas inside an `h-20` header bar.
- **Hero Mascot Bottom Alignment (`src/components/HeroTerminal.tsx`):**
  - Set the 12-column hero grid to `lg:items-end` and replaced the bottom radial fade with a top/side feather mask (`object-bottom`) so the bottom edge of the hero mascot sits on the exact same horizontal baseline as the `JOIN TELEGRAM` and `FOLLOW ON X` buttons.

### M20 — Zero Glow Across All Lines, Cards, and Buttons ✅
- Removed all `box-shadow` glows (`shadow-pump-glow`, `shadow-pump-pill`, wallet adapter button/modal shadows) and ambient background blur orbs.
- Replaced all green glowing borders (`rgba(85, 255, 153, 0.25)` and `hover:border-pump`) on section lines, dividers, cards, and buttons with clean matte `#1E2530` (`border-line`) borders across the entire platform.

### M21 — Hard Flat Toxic Theme Overhaul (`#4DFE15` / `#76FF32`) & Transparent Cutout Hero Image (`trenchlabs-hero-removebg.png`) ✅
- **Transparent Cutout Hero Image:** Converted the user's 32-bit ARGB TIFF cutout (`trenchlabs_hero-removebg.tif`) losslessly to `/images/trenchlabs-hero-removebg.png` (`1024x832`) and wired it directly into `HeroTerminal.tsx` with zero blend modes, zero masks, and bottom-aligned with the `FOLLOW ON X` button.
- **Hard Flat Toxic Theme (`tailwind.config.ts` & `src/app/globals.css`):**
  - Core toxic lime: `toxic.DEFAULT = #4DFE15`
  - Hover active state: `toxic.bright = #76FF32`
  - Low-contrast flat borders: `toxic.muted = #245415`
  - Hairline resting border: `toxic.border = #1C3D12`
  - Flat dark-tinted badge fill: `toxic.bg = #0E1A0C`
  - Flat opaque dark surfaces: `canvas = #0A0E13`, `surface = #11161D`, `surface-card = #161C24`
  - Enforced `boxShadow: { none: "none", DEFAULT: "none", ... }` and removed 100% of `backdrop-blur-*`, `blur-*`, gradients, and SVG `feGaussianBlur` filters across the entire codebase.

### M22 — Alpha Crypto Trade Calls Hub, Master Admin Desk (`FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e`), Multi-Chain Categorization (`SOL`, `BSC`, `ETH`, `BASE`, `ROBIN`, `AVAX`), Dual Risk Ratio, & Take Profit Multipliers ✅
- **Master Admin Wallet (`src/lib/config.ts`, `src/context/GenesisContext.tsx`, `src/app/api/alphas/route.ts`):**
  - Configured `ADMIN_WALLET = 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e'` with full access to `/dashboard` (bypasses the 1M `$GENESIS` gate) and full CRUD privileges (`POST`, `PATCH`, `DELETE` on `/api/alphas`) to publish, pin/unpin, mark TP hits, and delete calls.
  - Added a 1-click **Preview Admin Desk** toggle on `/dashboard` for local testing alongside live wallet recognition when `FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e` connects.
- **Persistent Call Storage (`data/calls.json` & `src/server/alphas-data.ts`):**
  - Server-side persistent JSON storage (`data/calls.json`) so calls posted or pinned by Admin persist across refreshes and restarts.
- **Every Trade Call Card Displays (`src/components/dashboard/IncubatorHub.tsx` & `AlphaInspectorModal.tsx`):**
  1. **Token Name & Ticker**
  2. **Contract Address (CA)** with 1-click Copy CA + external market links (DYOR / trade at your own risk)
  3. **Current Market Cap** + **Entry Market Cap**
  4. **Risk Ratio (Both):** Admin **Risk Level (`1–5`)** gauge AND calculated **Risk:Reward Ratio (`R:R`)** (e.g. `1:5 R:R`) + Stop-Loss (`-25% SL`)
  5. **Take Profit Multipliers:** Multiplier badges (`2x`, `5x`, `10x`) with implied target Market Cap and hit checkmarks (`✓`).
- **Blockchain Categorization:**
  - Full chain filter bar supporting **`ALL`, `SOL`, `BSC`, `ETH`, `BASE`, `ROBIN` (Robinhood Chain), and `AVAX`**.
- **Pinned Priority Calls Section:**
  - Dedicated **PINNED PRIORITY CALLS** banner & grid at the top of `/dashboard` for calls pinned by the Admin.


---

## 7. Blockers & Fixes

| ID | Blocker | Fix |
| --- | --- | --- |
| B-01..B-06 | See prior entries | Resolved |
| B-07 | Landing page (`/`) felt boxy and lacked typographic contrast & interactive depth | Unboxed hero typography onto architectural grid stage, added 28px live marquee to public header, upgraded `EXP01`–`EXP04` cards, and added interactive Tier Simulator + Cross-Chain Track Record ledger on `/` |
| B-08 | Hero image background box, multi-tier clutter, and AI `//` / `[BRACKET]` slop | Used `mix-blend-lighten` + radial mask feathering on `trench-rat-hero.jpg` aligned to the 12-col grid, consolidated gating to a single `1,000,000 $GENESIS` tier with 1 unified `JOIN THE LAB` card, replaced CA card with `BUY $GENESIS ON PUMP.FUN` + `JOIN TELEGRAM` & `FOLLOW ON X` buttons, and purged all `//` & `[BRACKET]` slop |
| B-09 | Generic lime green (`#7CFF5E`) instead of Pump.fun mint/pill green (`#55FF99` / `#86EFAC`) | Updated `tailwind.config.ts`, `globals.css`, and all components/SVGs to use the exact Pump.fun brand palette (`#55FF99`, `#86EFAC`, `#0A0E13`, `#11161D`, `#161C24`) |
| B-10 | Hero image bottom floated above the `FOLLOW ON X` button due to radial bottom mask + `items-center` | Changed hero grid to `lg:items-end` and updated image mask to feather only top/left/right while keeping `black 100%` at the bottom (`object-bottom`), aligning the hero image bottom flush with the `FOLLOW ON X` button |
| B-11 | Unwanted glow on lines, cards, and buttons | Overhauled theme to Hard Flat Toxic (`#4DFE15` / `#76FF32`, `#1C3D12` 1px flat hairlines, `#0E1A0C` flat badge fills, `boxShadow: none`) and replaced hero image with true 32-bit transparent cutout `trenchlabs-hero-removebg.png` |
