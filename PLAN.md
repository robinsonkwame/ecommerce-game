# E-Commerce Strategy Game — Implementation Plan

A Netlify-hosted, phone-friendly classroom game implementing `spec.md`. The
instructor ("host") runs the game from one browser and rolls the Risk Dice;
every student team watches the roll and its consequences land on their own
screen after they have locked in a choice.

## 1. Rules as implemented

The game runs on a **ruleset** stored in each game doc (`public/js/rules.js`).
Two exist:
- **Balanced** is the default.
- **Original spec** keeps spec.md's numbers exactly.

The full rationale and simulator results are in
[docs/BALANCE.md](docs/BALANCE.md).

Common to both, from the spec:

- 8 quarters, each with a vibe: New, Growing, Maturing, Saturated,
  Disruption, Disruption, Consolidation, Winner Takes All.
- Each team starts with **$600**, **0 points**, **0 risk**.
- Each quarter a team picks one action: Influencers, Customer service,
  Business innovation, or Buy down risk ($50 per point).
- Order each quarter: sell points if needed → pay cost → add score → add
  risk → host rolls one d6 for the class → if a team's risk is **above** the
  die, it suffers a risk event and its risk resets to 0. Risk carries over
  between quarters.
- At the end, highest points wins, and every team gets a **6-character
  completion code** (§3.3).

Where they differ:

| | Original spec | Balanced (default) |
|---|---|---|
| Risk event | −500 points, can go below 0 | −40% of points, never below 0 |
| Short of cash | Money goes below $0 | Can't overspend; sell points 50 → $50 with the choice |
| Table | spec.md | Reshaped so the strategy that fits the quarter scores best and is safest |

Decisions the spec leaves open:

| Question | Spec says | Default | Why |
|---|---|---|---|
| Buy-down price | "$100 reduces risk by 1" in the overview, "$50" in the table section | **$50 per point** | The table section is more detailed. |
| Buy-down instead of, or on top of, a strategy? | Listed as one of four choices; later "you can also always" | **Instead of** | A quarter spent de-risking is a quarter without score. |
| Team that never locks in | not covered | **Pass**: nothing happens, still faces the die | Keeps the game moving. |

## 2. Architecture

**Static site + Netlify Functions + Netlify Blobs. No framework, no build step.
Always HTTPS:** Netlify issues a certificate for every site and redirects plain
HTTP; `netlify.toml` adds an HSTS header so browsers never downgrade.

```
Students' phones ──poll /api/state every ~1.5s──▶ Netlify Function ──▶ Blobs
       │                                               ▲
       └── POST /api/submit (their choice) ────────────┘
Host browser ──── POST /api/host {action, key} ────────┘
```

- **Why polling, not websockets:** Netlify Functions can't hold sockets open.
  With ~10–15 teams polling every 1.5 s for a 20-minute game that is roughly
  10k invocations, well inside the free tier. Each state reply carries a short
  content hash; clients send it back and get a tiny `{unchanged:true}` reply
  when nothing moved. A student poll costs 2–3 Blob reads (game, own team,
  own choice); only the host's poll reads every team.
- **No two writers share a key.** The host writes the game doc and team docs;
  a team writes only its own choice key. A student locking in can never
  clobber a roll that's being applied.
- **Compare-and-swap on the game doc.** Every host action reads the game doc's
  etag and writes with `onlyIfMatch`, so a double-clicked Roll can't apply
  twice. Blobs is opened with `consistency: "strong"` so a poll right after a
  write sees it.
- **Clock sync.** Every state reply includes the server's time; clients keep
  an offset so the reveal lands together even on a phone with a wrong clock.
- **Host authentication:** one shared secret in the `HOST_KEY` environment
  variable. The host page asks for it in a password field and keeps it in
  `sessionStorage` for the tab; `/api/host` and the host's `/api/state` check it
  (timing-safe). Student endpoints need no key.
- **Team identity (low-stakes trust model):** a team types a name; it's
  slugified into the key and remembered in `localStorage`, so a reload or a
  teammate's phone typing the same name rejoins the same team. Anyone who
  knows a team's name can act as that team, the same as looking over a
  shoulder in class. Student replies never include other teams' docs, so
  codes can't be scraped from the API.
- **One code path.** `public/js/service.js` holds all server logic over a tiny
  key-value interface with etags. The Netlify functions run it on Blobs, the
  simulator runs it on localStorage, and the tests run it on a Map.
- **Local dev:** `netlify dev` serves the static files, runs the functions, and
  gives Blobs a local sandbox, so the whole thing runs offline on a laptop.
- **Simulated mode (`?debug=1`):** `api.js` swaps the Netlify backend for
  `mock-api.js`, which runs the same `service.js` against localStorage and
  notifies other tabs over BroadcastChannel. The host page gains bot teams and
  "bots choose", so one person can click through a whole game before
  deploying. The flag is sticky per browser; `?debug=0` clears it.

### 2.1 Blob layout (store: `ecommerce-game`)

All keys except `game` are scoped by the game's id, so **Reset** is one atomic
swap of the game doc; the old game's keys are then deleted best-effort.

```jsonc
// key: "game"
{
  "id": "k3m9x2qa", "version": 42,
  "phase": "rolled",             // lobby | choosing | rolled | finished
  "round": 3,                    // 1..8
  "dice": { "value": 4, "rollId": "k3m9x2qa:3", "at": 1730000000000, "revealAt": 1730000003000 } | null,
  "resolved": true,              // false while a roll is being applied to teams
  "final": [{ "slug": "team-rocket", "name": "Team Rocket", "points": 900, "money": 50 }] | null,  // no codes
  "settings": { "startMoney": 600, "buyDownCost": 50, "bustPenalty": 500, "rounds": 8, "revealDelayMs": 3000 }
}

// key: "g/<gameId>/teams/<slug>"        written by join and host actions only
{
  "name": "Team Rocket", "slug": "team-rocket",
  "money": 350, "points": 700, "risk": 2,
  "history": [
    { "round": 1, "action": "influencer", "qty": 0, "cost": 50, "score": 300, "riskAdded": 1,
      "dice": 6, "riskBeforeDice": 1, "busted": false, "penalty": 0, "money": 550, "points": 300, "risk": 1 }
  ],
  "completion": { "code": "K7M2QX", "at": 1730001234567 } | null,   // set by Finish
  "joinedAt": 1729999000000, "updatedAt": 1730000000000
}

// key: "g/<gameId>/choices/<round>/<slug>"   written by that team only
{ "round": 3, "action": "buydown", "qty": 2 }
```

### 2.2 Game phase machine (host drives every transition)

```
lobby ──Start game──▶ choosing(r=1) ──Roll──▶ rolled(r=1) ──Next quarter──▶ choosing(r=2) …
                                                                 rolled(r=8) ──Finish──▶ finished
any ──Reset (confirm)──▶ lobby (new game id)
```

- `lobby`: teams join; host sees them appear.
- `choosing`: teams lock in or change a choice for the current round; host
  sees a live "7 of 9 locked in" counter and each team's pick.
- **Roll** happens in two steps so the dice go out first:
  1. Compare-and-swap the game doc to `phase:"rolled"` with the value (server
     `crypto.getRandomValues`, or the host's physical die) and
     `revealAt = now + 3s`, `resolved:false`.
  2. Read every team and its choice, apply the quarter (a missing choice is a
     Pass), write the team docs, then set `resolved:true`.
  Step 2 skips teams that already have this round in their history, so if it
  fails halfway the host's **Finish applying the roll** button reruns it with
  the same dice and nothing is counted twice. Next/Finish wait for
  `resolved`.
- **Lock-in racing the roll:** after saving a choice the server re-reads the
  game doc. Because step 1 happens before step 2 reads choices, a game still
  in `choosing` proves the choice will count. Otherwise the player gets "The
  host rolled just as you locked in" instead of a silent drop.
- `rolled`: every client sees the new `rollId`, tumbles the die until
  `revealAt` (same instant on every screen), then shows consequences. While
  the die tumbles, tiles, leaderboard and the host's control table show the
  quarter's cost/score/risk applied (the spec's order) but hold back the bust
  penalty. Teams that joined after the roll are told it doesn't affect them.
- `finished`: debrief for the SHARE segment. **Finish** stamps every team doc
  with its completion code (§3.3) and writes public final standings.

### 2.3 Shared rules module

`public/js/rules.js` is a pure ES module used by **both** the browser (to
preview cost/score/risk before submitting) and the functions (to resolve the
round). It exports the 8×3 table, the vibe names and blurbs, `resolveTeam(team,
choice, dice, settings)`, and the constants above. It gets unit tests with
`node:test` so the scoring can't drift between client and server.

### 2.4 API

Each function declares its own path (`export const config = { path }`).

| Route | Method | Body / query | Does |
|---|---|---|---|
| `/api/state` | GET | `?team=<slug>&v=<hash>` | Game doc, that team's doc with its locked-in choice, and the team count while in the lobby. `{unchanged:true}` when `v` matches. |
| `/api/state` | GET | `?role=host&v=<hash>` + `X-Host-Key` | Game doc and every team with its choice. |
| `/api/join` | POST | `{name}` | Creates the team if new, or returns the existing one with that name. Refused once finished. |
| `/api/submit` | POST | `{slug, action, qty?}` | Saves the team's choice for the current round; refused unless `choosing`. |
| `/api/host` | POST | `{action: start\|roll\|next\|finish\|reset\|kick, value?, slug?}` + `X-Host-Key` | Phase transitions above. `value` 1–6 uses a physical die. |

Rule violations come back as `400` with a readable message, a lost
compare-and-swap as `409`, a bad key as `401`. Code verification and the
gradebook CSV need no endpoints: the host page already holds every team doc.

## 3. UI

Two pages, one stylesheet, mobile-first for students, large-type for the
projected host page.

### 3.1 Student page — `/` (phone)

1. **Join card** (first visit): team name input → "Join". Students never type
   an address: they scan the QR code on the projector or tap the join link the
   host pasted into Canvas or chat.
2. **Status bar** (always on top, sticky): three big tiles — **Money**,
   **Points**, **Risk** — plus "Q3 · Maturing" and a small "waiting for
   host / choose now / rolled" pill.
3. **Choose panel** (phase `choosing`): the quarter's vibe name and one-line
   blurb, then four big tappable cards. Under no-debt rules each card says
   how many points it would take to sell to afford it, or that the team
   can't afford it, and the lock button reads "Sell 150 pts and lock in":
   - Influencers · −$150 · +150 pts · +3 risk
   - Customer Service · −$100 · +200 pts · +1 risk
   - Business Innovation · −$200 · +200 pts · +1 risk
   - Buy Down Risk · stepper for how many points (max = current risk) · −$50 each
   Tapping a card shows a preview line ("After this: $200 · 850 pts · risk 4")
   and a **Lock in** button; a locked card gets a check and "You can still
   change until the host rolls". If cost > money the button says "Lock in
   (goes negative)".
4. **Dice panel** (phase `rolled`): full-width animated die tumbling until
   `revealAt`, then the face lands. Below it the verdict slides in:
   - safe: "Risk 3 ≤ 4 — you dodged it" (green)
   - bust: "Risk 5 > 4 — RISK EVENT! −500 points, risk reset to 0" (red,
     screen shake)
   followed by the delta strip (−$100 · +200 pts · +1 risk) and the tiles
   animating to their new values. Then "Waiting for the host to start Q4…".
5. **Playbook drawer** (collapsible, any phase): the full 8×3 table with the
   current quarter's row highlighted and past rows showing what the team
   picked, so teams can plan their 2-year strategy as the spec asks.
6. **Final screen** (phase `finished`): the team's rank, final numbers, its
   8-quarter strategy timeline, and the **completion code** in large type
   with a one-tap **Copy** button and the line "Paste this code into the
   assignment to get credit. It was generated from your final score and the
   time you finished, so it is unique to your team."

### 3.2 Host page — `/host` (laptop → projector)

Left column (controls, can be collapsed for projecting):

- Round/vibe header, phase pill, team count and "submitted x/y".
- **Copy join link** (one click, paste into Canvas or chat).
- Team table: name · current pick (or "—") · money · points · risk · last seen.
  A small ✕ per row removes a stray/duplicate team.
- One primary button that changes with the phase: **Start game → Roll the
  Risk Dice → Next quarter → Finish**. A dim **Reset game** with a confirm.
  Roll asks for confirmation if not everyone has submitted. Buttons lock
  while a request is in flight.
- **Die value** picker under Roll: random (server) by default, or 1–6 to use a
  physical die.

Right column (big, for the projector):

- Lobby: a large **QR code** for the join link plus the teams that have
  joined so far.
- Giant die that animates on Roll (same animation as the phones).
- After the roll: a result strip — which teams busted (red chips) and which
  were safe (green chips).
- Live **leaderboard** sorted by points, with money and risk; negative money
  shown in red.

The debrief view adds a **completion codes** column, the Verify box and
Download CSV (§3.3).

`finished` replaces the right column with the **Debrief** view for the SHARE
questions: ranked leaderboard, a "fell under $0" list, and a grid of each
team's 8 choices colour-coded by strategy so "how did you shift?" is visible.

### 3.3 Completion code

Generated **on the server** when the host clicks Finish, never in the browser,
so a student can't mint one.

- Input: `slug | final points | final money | the 8 actions joined | finishedAt`
  (finish timestamp in ms). So two teams with the same score still differ,
  and a team can't reuse last term's code.
- `code = base32(HMAC-SHA256(HOST_KEY, input))[0..6]` using a 32-letter
  alphabet with `0/O/1/I` removed, uppercase. 32^6 ≈ 1 billion values, so
  collisions among a class of teams are not a concern, and a guessed code is
  practically never valid.
- Stored on the team doc (`completion`) so it survives reloads; the student
  page shows the stored value and never recomputes it.
- Grading: the host page's debrief view lists every team's code, has a
  **Verify** box (paste a code → which team, score, finish time), and a
  **Download CSV** button for the gradebook (cells quoted, and team names
  that look like spreadsheet formulas are defused). Because the
  code is an HMAC, the host can also re-verify later from the CSV alone without
  trusting the student's copy.

### 3.4 Dice animation

Pure CSS 3D cube (six faces with pips) with a `tumbling` keyframe; JS stops the
tumble at `revealAt` and applies the rotation for the landed face. With
`prefers-reduced-motion` it skips the tumble and shows the face. The landing
doesn't wait for an animation frame, so a phone that was locked during the
roll still shows the right face when it wakes.

## 4. Repository layout

```
ecommerce-game/
├─ netlify.toml                  publish=public, esbuild functions, HSTS, [dev] static
├─ package.json                  @netlify/blobs; npm run dev / test / preview
├─ .env.example                  HOST_KEY for netlify dev (.env is gitignored)
├─ public/
│  ├─ index.html  host.html  css/style.css
│  └─ js/
│     ├─ rules.js                rulesets (balanced, spec), resolveTeam (pure)
│     ├─ engine.js               phase machine (pure)
│     ├─ service.js              server logic over a KV store with etags
│     ├─ kv.js                   KV store over a Map or localStorage
│     ├─ code.js                 HMAC completion code
│     ├─ api.js                  fetch client, clock sync, poller
│     ├─ mock-api.js             ?debug simulator (service.js on localStorage)
│     ├─ dice.js                 3D die
│     └─ student.js  host.js
├─ netlify/functions/
│  ├─ state.mjs  join.mjs  submit.mjs  host.mjs
│  └─ _lib/server.mjs            Blobs adapter, auth, JSON/error handling
├─ tools/balance.mjs             balance simulator (npm run balance)
├─ docs/BALANCE.md               balance design and results
├─ test/rules.test.mjs  test/service.test.mjs  test/balance.test.mjs
├─ spec.md
└─ README.md
```

## 5. Status

Built and verified:
- Balanced ruleset with points-for-cash exchange, tuned with the simulator
  (docs/BALANCE.md); a test guards its targets.
- 25 unit tests: rules, engine, and the service on an in-memory store, including
  double rolls, a lock-in racing the roll from both sides, a half-applied roll,
  reset, kick and late joins.
- Every endpoint exercised with curl under `netlify dev` (Blobs local
  sandbox): auth failures, rule violations, unchanged polls, HSTS and
  no-store headers.
- A live run in the browser against `netlify dev`: host key form, join,
  lock-in, a forced die, busts, synchronized reveal on host and phone,
  finish with matching codes.
- A scripted eight-quarter simulated game with four bots.

Not done: deploying to Netlify and a run-through on real phones (step 8).

## 6. Implementation steps

1. **Scaffold** — netlify.toml, package.json, copy spec.md in, README.
2. **Rules module + tests** — table transcription checked against spec,
   `resolveTeam`, buy-down, pass, bust/reset; tests green.
3. **Functions + store** — all four endpoints against Blobs; exercise with
   `curl` under `netlify dev`.
4. **Student page** — join, status tiles, choose panel, playbook, polling.
5. **Host page** — controls, team table, leaderboard, phase button.
6. **Dice + consequences** — cube animation, synchronized reveal, verdict and
   delta animations on both pages.
7. **Debrief view + completion codes** — HMAC code on Finish, student copy
   button, host verify box and CSV export; then polish (reduced motion,
   reconnect after sleep, late joiners mid-game).
8. **Deploy** — create the Netlify site from the GitHub repo, set `HOST_KEY`,
   first live run-through with two phones + laptop.

Steps 4 and 5 can be built in parallel once 3 is done.

## 7. Open questions for the instructor

- Confirm the defaults in §1 (especially $50 vs $100 buy-down, and
  "one action per quarter").
- Should students see the *leaderboard* during the game, or only their own
  team until the debrief? (Default: only their own team; the projector shows
  the leaderboard.)
- Will the host page be the projected screen, or do you want a separate
  `/board` page with no controls? (Default: host page with a collapsible
  control column.)
