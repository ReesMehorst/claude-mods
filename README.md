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
  (review requests, your PRs, issues assigned to you), **Notifications** (unread, this repo).
  Hotkeys `1`–`5`, `r` refresh.
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
  Merge asks for a second `m` press; changing the selection or Close cancels it.
- Refreshes every 60 s while the pane is open, with toasts when a PR's checks turn red,
  your review is requested, your PR is approved, or a run on your PR's branch finishes.
  Errors back off (up to 10 min); no repo or `gh` signed out pauses polling until `r`.

## Develop

```
claude plugin validate ./usage-band
claude plugin test ./usage-band
```
