# claude-mods

Claude Code mods by [ReesMehorst](https://github.com/ReesMehorst).

## Install

```
/plugin marketplace add ReesMehorst/claude-mods
/plugin install usage-band@reesmehorst
/plugin install github-pane@reesmehorst
```

Answer `y` to add the marketplace, then pick a scope.

## Mods

### usage-band

A band above the prompt that shows where your session stands, with a small orange mascot
that tells you the one thing worth doing next.

**The mascot (0.6.0)**: on desktop, VS Code and mobile the band opens with an animated mascot
whose mood follows the most urgent segment: toasty (cache warm), busy (a turn is running),
shivering (cache about to lapse), stoking the fire (keep-warm is on), frozen (cache cold),
stuffed (context filling up), sweating over money (API budget nearly spent) or racing the clock
(a plan limit on pace past 100%). Its speech bubble offers one action when there is one:
*Compact now* when the context is filling up, *Keep it warm* (or *Turn on keep-warm* once the
cache is cold). *Later* hides that action until the situation changes. Every other action sits
behind the **⋯** button: Compact, Clear, Keep warm on/off, Refresh and Hide.

Each segment has its own picture:

- **Context**: a ring with the fill, the tokens used of the window, and turns left to 80%.
- **Prompt cache**: a thermometer that drains as the cache lifetime runs out (pulsing while a
  turn runs, icy once cold), with the countdown.
- **5-hour and weekly limits** (plan only): a pace bar with what is used, a hatched forecast of
  where the window lands at this pace, and a tick for how far into the window you are. The weekly
  limit also gets seven **day tiles** in GitHub greens, one per day of the window, shaded by how
  much of the limit that day used. The tiles are built from samples the mod takes at the end of
  each turn while it runs (kept across sessions), so days without Claude Code open stay blank.
- **Money**: on a plan, the session's "API value" as muted text (it is included in the plan).
  On API credits, a fuel gauge against your budget when one is set, otherwise spend with `$/hr`.
- **Tokens**: a split bar of cache reads, new input and output.

**Hide** (or `/usage-band`) collapses the band to chips: a napping mascot and one chip per
segment with an icon, the value and a mini meter (plan: context, cache, 5h, week, API value;
API: context, cache, spend, tokens). *Show* brings the full band back; the choice is remembered.

**Plan vs API**: the band shows "Plan usage" once your subscription reports rate limits, "API
usage" once something is billed without them, and plain "Usage" before either. A plan never
talks budget and API never talks pace. On API credits the keep-warm suggestion says the pings are
billed.

The terminal keeps the text band:

- **Plan mode** (Pro/Max subscription): 5-hour and weekly limits with pace projection
  (`pace → 120%`) and when you'll hit 100% at that pace (`hits 100% ~16:40`).
  Session cost is shown muted as "API value".
- **API mode** (API credits): spend leads, with `$/hr`. Set a budget under
  `/config` → *API budget (USD)* for a budget bar and ETA.
- **Context** fill, and a **token** breakdown (in / out / cache hit %).
- **Prompt cache**: a countdown to when the cache your chat is riding on lapses (5 min, or
  1 h when the cache was written that way), then `cold`. A toast warns a minute before
  (five on the 1 h cache) and another when it goes cold, since the next message then re-caches
  the whole context. No alerts while the context is under 20k tokens (`Cache alert minimum`).
- **Keep warm** (opt in): `/keep-warm on` (or *Keep prompt cache warm* under `/config`) sends a
  tiny tool-less ping over your transcript shortly before the cache lapses, which renews it.
  A ping is a cache read of your context plus one word out, billed to the session and counted in
  `/cost`; it is cheaper than re-caching, but not free. At most 3 per idle stretch
  (*Keep-warm pings per idle stretch*), reset by your next message; after that you get the usual
  alert. Pings never fire mid-turn or once the cache is already cold.
- **Warnings** as toasts on every surface: context ≥ 80%, a limit on pace past 100%, spend ≥ 90% of budget.
- `/usage-band` toggles a compact one-line view (remembered across sessions).
<img width="782" height="256" alt="image" src="https://github.com/user-attachments/assets/11e24f74-ddf0-4bcb-afa6-664acc065c97" />

### github-pane

`/github` opens a live pane for the repo you're in (needs the [`gh`](https://cli.github.com) CLI, signed in).

- **This branch**: the PR for your checked-out branch, pinned above the tabs.
- Tabs: **Pull requests**, **Checks** (workflow runs), **Issues**, **For me**
  (review requests, your PRs, issues assigned to you), **Notifications** (unread, this repo).
  Hotkeys `1`–`5`, `r` refresh.
  In the desktop app the tabs are one segmented row with a count pill each (red when the tab
  has failing items); in a narrow pane they become a full-width **View** dropdown and rows drop the branch.
- Each row: CI status, title, branch → base, author, review state, age.
  In the desktop app a row is two lines, with review and CI as coloured pills; a selected
  row opens a card under it with its actions and details: the PR description as formatted
  markdown, reviewers with a state pill each, failed logs and checks in a code block.
- Select a row for actions: open on GitHub, `c` checkout a PR, `x` rerun failed jobs,
  `l` show the failed-step log inline, `e` mark a notification read.
- On a failed run or PR: `f` **Fix with Claude** puts the failed log and a fix request in
  the prompt box as a draft. Nothing is sent until you press Enter.
- On a PR: `d` details (diff stat, mergeable state, reviewers, description), `a` approve
  (not on your own PRs), `y` mark a draft ready, `m` squash-merge and delete the branch.
  Merge asks for a second `m` press; changing the selection or Close cancels it. In the
  desktop app the first press shows a confirm card with Merge and Cancel instead.
- Desktop app: a full-width **Filter** field above the list (click it, then type; ctrl+U clears) narrows the tab by title, `#n`, branch or
  author; switching tabs clears it. An empty tab says why it is empty.
- Refreshes every 60 s while the pane is open, with toasts when a PR's checks turn red,
  your review is requested, your PR is approved, or a run on your PR's branch finishes.
  Errors back off (up to 10 min); no repo or `gh` signed out pauses polling until `r`.

<img width="724" height="978" alt="image" src="https://github.com/user-attachments/assets/1c2217b3-0fcb-4dc6-a153-a09ec6912e1d" />
<img width="722" height="928" alt="image" src="https://github.com/user-attachments/assets/7282696a-db99-4a64-95e6-11548bd338f0" />

## Develop

```
claude plugin validate ./usage-band
claude plugin test ./usage-band
```
