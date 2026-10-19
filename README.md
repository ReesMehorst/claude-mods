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

A band above the prompt that shows where your session stands.

- **Plan mode** (Pro/Max subscription): 5-hour and weekly limits with pace projection
  (`pace → 120%`) and when you'll hit 100% at that pace (`hits 100% ~16:40`).
  Session cost is shown muted as "API value".
- **API mode** (API credits): spend leads, with `$/hr`. Set a budget under
  `/config` → *API budget (USD)* for a budget bar and ETA.
- **Context** fill, and a **token** breakdown (in / out / cache hit %).
- **Warnings** as toasts: context ≥ 80%, a limit on pace past 100%, spend ≥ 90% of budget.
- `/usage-band` toggles a compact one-line view (remembered across sessions).

### github-pane

`/github` opens a live pane for the repo you're in (needs the [`gh`](https://cli.github.com) CLI, signed in).

- **This branch**: the PR for your checked-out branch, pinned above the tabs.
- Tabs: **Pull requests**, **Checks** (workflow runs), **Issues**, **For me**
  (review requests, your PRs, issues assigned to you). Hotkeys `1`–`4`, `r` refresh.
- Each row: CI status, title, branch → base, author, review state, age.
- Select a row for actions: open on GitHub, `c` checkout a PR, `x` rerun failed jobs,
  `l` show the failed-step log inline.
- Refreshes every 60 s while the pane is open; toasts when a PR's checks turn red.
  Errors back off (up to 10 min); no repo or `gh` signed out pauses polling until `r`.

## Develop

```
claude plugin validate ./usage-band
claude plugin test ./usage-band
```
