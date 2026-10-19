# github-pane expansion: handoff

The plan has four phases. Phase 1 is merged, phase 2 is in review; phases 3–4 are open.
Each phase is one PR off `main`, version bumped, README updated.

## Where things stand

- **Phase 1**: merged in [PR #3](https://github.com/ReesMehorst/claude-mods/pull/3), version 0.2.0.
  - Still open: a live check. Open `/github`, check the "This branch" row,
    close the pane, and confirm polling stops.
- **Phase 2**: done, version 0.3.0, branch `claude/loving-kirch-6575ed`.
  - Still open: a live check on a throwaway test PR: `d`, `a`, `y`, and `m` twice.
- **Phases 3–4**: not started. Branch each one off `main` once phase 2 merges, or off
  the phase 2 branch if it hasn't merged yet.

## Code map

- `hooks/register.tsx` holds the hooks.
  - `poll()` refreshes, then schedules the next poll with `$.clock.after`.
    `/github` starts it and `ui.close` on `{ id: PANE }` stops it.
  - `refresh()` runs the `gh` calls in parallel, writes the `snap` atom, and
    returns the error message or `null`.
  - `act()` runs one `gh` row action and shows its output in the detail box.
  - `actions(r)` holds the per-row buttons. `rowView(r)` draws one row and is
    used by the tabs and by the "This branch" row.
- `hooks/format.ts` holds pure helpers: row builders, `checks`, `nextDelay`,
  `logTail`, `newlyFailed`. Put new logic here so it can be tested.
- `hooks/format.test.ts` holds the tests (`claude-code/testing`).
- `types/index.d.ts` holds the `Row`, `Snapshot` and `PluginState` contract.
  Every new atom key needs declaring here, or `validate` fails.

## Check before each PR

```bash
claude plugin validate ./github-pane
```

```bash
claude plugin test ./github-pane
```

To type-check, find this build's API types: load the `plugin-authoring` skill,
which names `.../plugin-authoring/types/claude-code.d.ts`. Write a scratch
`tsconfig.json` outside the repo whose `files` list that `.d.ts`,
`types/index.d.ts`, `hooks/register.tsx` and `hooks/format.ts`. Use Windows paths
(`C:/Users/...`). Compiler options: `jsx: react`, `jsxFactory: h`,
`jsxFragmentFactory: Fragment`, `strict`, `noEmit`, `skipLibCheck`,
`moduleResolution: bundler`. Then run `npx -p typescript@5.6.3 tsc -p <that tsconfig>`.

## Gotchas found in phase 1

- `gh pr status --json` returns `{ currentBranch, createdBy, needsReview }`.
  `createdBy` **leaves out** the current branch's PR, so it can't replace the
  `--author @me` list.
- `gh pr status` is wrapped in `.catch(() => null)`, so a detached HEAD only
  hides the row.
- Module variables (`isOpen`, `timer`, `prevChecks`) reset on hot reload, while
  atoms don't. `session.start` checks `$.ui.panes()` to resume polling.
- A `hotkey` must be one digit or lowercase letter. `hotkey="escape"` passed
  validate and tsc, but the engine skipped the whole render, so the pane went
  blank whenever the detail box showed. `hooks/pane.test.tsx` now mounts the
  pane on desktop and terminal to catch that.
- `validate` notes "gating hook without .catch: ui.close". This is harmless,
  because the hook can't throw.
- Hotkeys already taken: `1`–`4` (tabs), `r` (refresh), `c` (checkout), `x` (rerun),
  `l` (failed log / show checks), and from phase 2 `d` (details),
  `a` (approve), `y` (ready), `m` (merge).

## Phase 2: PR detail and actions ✅

**Goal:** selecting a PR shows more about it and lets you act on it.

- **Detail view:** run `gh pr view <n> --json body,reviewRequests,latestReviews,mergeable,mergeStateStatus,additions,deletions,changedFiles`.
  Fetch it on demand from a "Details" button (hotkey `d`) through `act()`, not in
  `refresh()`.
  - Format it in a new `prDetail()` in `format.ts`: diff stat, then mergeable
    state, then reviewers with their state, then the body clipped to about 20 lines.
- **Actions:**
  - **Approve** (`a`): `gh pr review <n> --approve`. Hide it on your own PRs.
    That needs the viewer login, from one `gh api user -q .login` cached in a
    module variable.
  - **Ready** (`y`): `gh pr ready <n>`. Shown only on drafts. This needs `isDraft`
    on `Row`, or `kind: 'pr'` plus a flag.
  - **Merge** (`m`): `gh pr merge <n> --squash --delete-branch`. Merging can't be
    undone, so it needs a confirm step. The first press sets a `confirm` atom to the
    row key and shows "Press m again to squash-merge #n". The second press runs it.
    Changing the selection clears it. Declare `confirm` in `types/index.d.ts`.
- **Tests:** `prDetail` formatting, and the confirm-state transitions if that logic
  goes in `format.ts`.
- **Done when:** the detail view shows for any PR, approve/ready/merge work on a
  test PR, and merge never runs on a single press.

## Phase 3: More toasts

**Goal:** you hear about changes that need you, the way you already do for red
checks. These only fire while the pane is open, since phase 1 polls only then.

Generalise `newlyFailed(prev, rows)` into a diff of two snapshots, so first poll =
no toasts holds for every kind:

- **Review requested from you:** a PR key in `mine` that comes from the
  `review-requested:@me` list and wasn't there last poll. `refresh()` merges that
  list into `mine`, so keep its keys apart.
- **Your PR approved:** `reviewDecision` changed to `APPROVED` on a PR in the
  `--author @me` list. This needs `reviewDecision` kept on `Row`, or a parallel map.
- **Your run finished:** a run in `checks` by you went from pending to done.
  Add `--user @me` as its own call, or compare by `headBranch` against your PRs.
  Toast ✓ or ✗.

Keep `prevChecks`-style state in one module variable holding the last snapshot.

- **Tests:** diff function on hand-built snapshots, including that the first poll
  gives no toasts.
- **Done when:** each toast fires once, per change, and not again after a reload.

## Phase 4: Notifications and Claude hand-off

- **Notifications tab:** add a 5th tab (hotkey `5`) from
  `gh api repos/{owner}/{repo}/notifications`. `repo` is already in `snap`.
  - Add a `notifRow()` in `format.ts`: reason, subject type, title, age.
  - Notification URLs are API URLs, so map them to `html_url`. For PRs and
    issues, build the URL from the subject URL's number.
  - Action: mark read (`gh api -X PATCH notifications/threads/<id>`).
  - Add `'notifs'` to `Tab`, `TABS`, `EMPTY.rows`.
- **"Fix with Claude" button** (`f`) on failed runs and failed PRs. The API
  supports this:
  - `$.prompt.fill({ text })` puts a draft in the prompt box for the user to
    edit and send. Use this one.
  - `$.prompt.submit({ text })` sends a turn straight away. Don't use it as the
    default.
  - The text: run/PR id, branch, and `logTail(log, 60)` in a fenced block, plus
    "Find and fix the cause of this CI failure."
  - Fetch the log with `gh run view <id> --log-failed`. For a PR, take the
    failing run id from `gh pr checks <n> --json link,state`.
- **Tests:** `notifRow` and the URL mapping, plus the fix-prompt text builder.
- **Done when:** the notifications tab lists and marks read, and `f` fills the
  prompt box with the log without sending it.
