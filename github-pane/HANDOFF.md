# github-pane: desktop UI handoff

The pane works on every surface, but it draws one terminal-style tree everywhere.
In the Claude desktop app that looks like bracketed `[ Tab ]` buttons, `r:` hotkey
prefixes, one long grey line per row, and all detail text in monospace. This plan
uses what the desktop surface can draw to make the pane read like an app panel.
The terminal look stays as it is.

Each phase is one PR off `main`, version bumped, README updated if behaviour changes.

## What the desktop surface has

From this build's API types (`plugin-authoring` skill → `types/claude-code.d.ts`,
grep `desktop: {`):

- **Elements:** `Box`, `Text`, `Button`, `Link`, `Input`, `Select`, `Svg`, `Code`,
  `Markdown`, `Client`. The terminal table differs, so check with `'Markdown' in els`
  (or `e.surface === 'desktop'`) before using one, and fall back to the current tree.
- **Box:** `hover` (background/border on hover), `backgroundColor`, `borderStyle`,
  `borderColor`, `gap`, `padding*`, `width`/`minWidth`, `overflow`.
- **Text:** `size` (`caption` … `title`), `weight`, `backgroundColor`, `tabular`,
  `wrap: 'truncate-end'`, `hover`.
- **Button:** desktop draws a native button. `variant`, `plain`, `dimColor`, `hover`.
- **Markdown:** `text`, `onLinkPress`. **Code:** `source`, `language`, `wrap`.
- **Input:** `onInput`, `onSubmit`, `placeholder`. **Select:** `options`, `onSelect`.

## Phase 1: rows and header

**Goal:** the list reads like an app list, not a log.

- Split drawing by surface: keep `rowView` for the terminal, add a desktop variant.
- Desktop row = a `Box` with `hover={{ backgroundColor: ... }}`, `paddingX`, two lines:
  - line 1: status glyph in its tone, title (`weight="medium"`, `wrap="truncate-end"`).
  - line 2: `size="caption"` dim meta (`#n · branch → base · @author`), age on the right
    (`justifyContent="space-between"`, `tabular`).
  - Review state and CI as small pills: `Text` with `backgroundColor` per tone.
- Selected row: tinted background instead of the `▸` marker.
- Header: repo name `size="heading"`, "updated 21:19 · every 60s" as a caption,
  Refresh as a plain button without the `r:` text.
- Error: a bordered `Box` in `borderColor="error"`, not a red line.
- **Tests:** `pane.test.tsx` already mounts `desktop`. Assert the row keys and pill text
  there; the terminal tree must not change (existing assertions hold).
- **Done when:** a screenshot of the desktop pane shows two-line rows with hover, and the
  terminal pane looks the same as before.

## Phase 2: detail panel

**Goal:** details, logs and checks are readable without squinting at monospace.

- PR description (`prDetail` body) through `Markdown`, so headings, lists and links render.
  Split `prDetail` into `{ stat, merge, reviewers, body }` so the desktop can lay the
  parts out and the terminal can still join them into text.
- Reviewers as a small list with a state pill each (approved / changes / requested).
- Failed log and `gh pr checks` output through `Code` (`wrap="wrap"`), so long lines
  keep their columns.
- Detail opens directly under the selected row (an inset card), not at the bottom of the
  pane, so it's visible without scrolling.
- Action buttons: primary for the main action per kind (Merge on PRs, Rerun on red runs,
  Fix with Claude on failures), secondary for the rest. Hide hotkey hints on desktop; the
  hotkeys still work.
- **Tests:** `prDetail` split; desktop mount finds a `Markdown` node with the body.
- **Done when:** a PR with a real markdown body shows formatted, and a failed log shows
  in a code block.

## Phase 3: confirm, filter and empty states

**Goal:** fewer surprises.

- **Merge confirm:** on desktop, the first Merge press shows an inline card: "Squash-merge
  #n and delete `branch`?" with **Merge** (primary) and **Cancel**. Keep `confirmPress`
  and the `confirm` atom; only the drawing changes. Terminal keeps "press m again".
- **Filter:** an `Input` above the list (`placeholder="Filter"`), filtering the current
  tab by title, `#n`, branch and author. Keep the query in a new `filter` atom (declare
  it in `types/index.d.ts`). Clear it on tab change. Pure match function in `format.ts`.
- **Empty states** that explain, since the Notifications tab confused a live test:
  - Notifications: "No unread notifications for `owner/repo`. This tab shows this repo
    only." plus a link to `https://github.com/notifications`.
  - Checks: "No workflow runs in this repo."
  - For me: "Nothing waiting on you."
- **Tests:** filter function; desktop mount shows the confirm card and Cancel disarms it.
- **Done when:** merge on desktop needs the card's Merge button, the filter narrows the
  list as you type, and each empty tab says why it is empty.

## Phase 4 (optional): tabs and counts

- Tabs as a segmented row: plain buttons, the active one with a tinted background and
  `weight="semibold"`, counts as caption pills. Red pill when a tab has failing items.
- If a `Select` reads better in a narrow pane (`bodyColumns < 50`), use it for tabs there.

## Code map

- `hooks/register.tsx`: hooks. `poll()` refreshes and schedules the next poll;
  `refresh()` runs the `gh` calls and writes `snap`; `act()` runs one row action into
  the `detail` box; `fix()` fills the prompt box; `actions(r)` and `rowView(r)` draw.
- `hooks/format.ts`: pure helpers (row builders, `checks`, `toasts`, `logTail`,
  `prDetail`, `confirmPress`, `notifRow`, `fixPrompt`). New logic goes here, tested.
- `hooks/format.test.ts`, `hooks/pane.test.tsx`: tests (`claude-code/testing`).
  `pane.test.tsx` mocks every `gh` call in `process.run`; extend it when adding calls.
- `types/index.d.ts`: `Row`, `Snapshot`, `PluginState`. Every new atom key goes here.

## Check before each PR

```bash
claude plugin validate ./github-pane
```

```bash
claude plugin test ./github-pane
```

Type-check: a scratch `tsconfig.json` outside the repo whose `files` list the API
`.d.ts`, `types/index.d.ts`, `hooks/register.tsx` and `hooks/format.ts` (Windows paths),
with `jsx: react`, `jsxFactory: h`, `jsxFragmentFactory: Fragment`, `strict`, `noEmit`,
`skipLibCheck`, `moduleResolution: bundler`. Run `npx -p typescript@5.6.3 tsc -p <it>`.

Live check on desktop: from a repo with activity (MotoSphere has notifications and
failed runs; claude-mods has neither), run
`claude --plugin-dir C:/Users/MeesR/claude-mods/github-pane`, then `/github`.

## Gotchas

- Module variables (`isOpen`, `timer`, `prevSeen`, `viewer`) reset on hot reload; atoms
  don't. `session.start` checks `$.ui.panes()` to resume polling.
- `gh pr checks` exits non-zero when checks fail or are pending; read its stdout directly
  (see `fix()`), don't go through `gh()`.
- `--log-failed` ends each job with post-job cleanup; `logTail` drops it.
- `validate` notes "gating hook without .catch: ui.close". Harmless.
- Hotkeys taken: `1`–`5` tabs, `r` refresh, `c` checkout, `d` details, `a` approve,
  `y` ready, `m` merge, `x` rerun, `l` log/checks, `f` fix, `e` mark read, `escape`.
