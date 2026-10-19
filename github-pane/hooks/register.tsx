import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Row, Snapshot, Tab } from '../types'
import { confirmPress, issueRow, logTail, newlyFailed, nextDelay, prDetail, prRow, runRow } from './format'

const PANE = 'github-pane'
const EVERY_MS = 60_000
const TABS: [Tab, string][] = [['prs', 'Pull requests'], ['checks', 'Checks'], ['issues', 'Issues'], ['mine', 'For me']]
const DETAIL_FIELDS = 'body,reviewRequests,latestReviews,mergeable,mergeStateStatus,additions,deletions,changedFiles'
const PR_FIELDS = 'number,title,author,isDraft,headRefName,baseRefName,reviewDecision,statusCheckRollup,updatedAt,url'
const ISSUE_FIELDS = 'number,title,labels,assignees,updatedAt,url'
const EMPTY: Snapshot = { repo: null, rows: { prs: [], checks: [], issues: [], mine: [] }, here: null, at: 0, error: null }

const snap = atom({ plugin: 'github-pane', key: 'snap' } as const, EMPTY)
const tab = atom({ plugin: 'github-pane', key: 'tab' } as const, 'prs' as Tab)
const selected = atom({ plugin: 'github-pane', key: 'selected' } as const, null as string | null)
const detail = atom({ plugin: 'github-pane', key: 'detail' } as const, null as string | null)
const busy = atom({ plugin: 'github-pane', key: 'busy' } as const, null as string | null)
const confirm = atom({ plugin: 'github-pane', key: 'confirm' } as const, null as string | null) // row key armed for merge

type $ = EngineInterface

async function gh($: $, args: string[], timeoutMs = 30_000) {
  const r = await $.process.run(['gh', ...args], { timeoutMs })
  if (r.exitCode !== 0) throw new Error(r.stderr.trim().split('\n')[0] || `gh exited ${r.exitCode}`)
  return r.stdout
}
const ghJson = async ($: $, args: string[]) => JSON.parse(await gh($, args))

let prevChecks: Map<number, boolean> | null = null // ponytail: module variable, resets on reload (no toast storm)
let isRefreshing = false
let isOpen = false // polls only while the pane is open
let timer: Timer | null = null
let delay = EVERY_MS
let viewer: string | null = null // your login, fetched once; hides Approve on your own PRs

// Refreshes now, then schedules the next poll by the result (backoff, or stop when retrying can't help).
async function poll($: $) {
  if (isRefreshing) return // the in-flight poll schedules the next one
  timer?.cancel()
  timer = null
  const d = nextDelay(delay, await refresh($), EVERY_MS)
  if (d === null || !isOpen) return
  delay = d
  timer = $.clock.after(d, () => void poll($))
}

// Returns the error message, or null on success.
async function refresh($: $): Promise<string | null> {
  isRefreshing = true
  try {
    const repo = (await ghJson($, ['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner as string
    const now = await $.clock.now()
    const [prs, runs, issues, review, authored, assigned, status, login] = await Promise.all([
      ghJson($, ['pr', 'list', '-L', '30', '--json', PR_FIELDS]),
      ghJson($, ['run', 'list', '-L', '20', '--json', 'databaseId,displayTitle,status,conclusion,workflowName,headBranch,event,createdAt,url']),
      ghJson($, ['issue', 'list', '-L', '30', '--json', ISSUE_FIELDS]),
      ghJson($, ['pr', 'list', '--search', 'review-requested:@me', '--json', PR_FIELDS]),
      ghJson($, ['pr', 'list', '--author', '@me', '--json', PR_FIELDS]),
      ghJson($, ['issue', 'list', '--assignee', '@me', '--json', ISSUE_FIELDS]),
      ghJson($, ['pr', 'status', '--json', PR_FIELDS]).catch(() => null), // detached HEAD etc.: no header, not an error
      viewer ?? gh($, ['api', 'user', '-q', '.login']).then(o => o.trim() || null, () => null),
    ])
    viewer = login
    const cur = status?.currentBranch
    const prRows = prs.map((p: any) => prRow(p, now))
    const mine = [...review, ...authored].map((p: any) => prRow(p, now))
      .filter((r: Row, i: number, all: Row[]) => all.findIndex(x => x.key === r.key) === i)
      .concat(assigned.map((i: any) => issueRow(i, now)))

    for (const r of newlyFailed(prevChecks, prRows)) $.ui.toast(`✗ Checks failed on #${r.id}: ${r.title}`, { timeoutMs: 10_000 })
    prevChecks = new Map(prRows.map((r: Row) => [r.id, r.isFailed]))

    await update($, snap, () => ({
      repo,
      rows: { prs: prRows, checks: runs.map((r: any) => runRow(r, now)), issues: issues.map((i: any) => issueRow(i, now)), mine },
      here: cur?.number ? { ...prRow(cur, now), key: 'here' } : null,
      at: now,
      error: null,
    }))
    return null
  } catch (err: any) {
    const at = await $.clock.now()
    const error = String(err?.message ?? err)
    await update($, snap, s => ({ ...s, at, error }))
    return error
  } finally {
    isRefreshing = false
  }
}

// Runs a row action, shows its output (or error) in the detail box.
async function act($: $, label: string, args: string[], show: (out: string) => string, refreshAfter = true) {
  await update($, busy, () => label)
  try {
    const out = await gh($, args, 120_000)
    await update($, detail, () => show(out))
    if (refreshAfter) void poll($)
  } catch (err: any) {
    await update($, detail, () => `${label} failed: ${err?.message ?? err}`)
  } finally {
    await update($, busy, () => null)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'github', description: 'Open the GitHub pane for this repo' })
    // A reload keeps the pane up but resets module state: resume polling.
    if ((await $.ui.panes()).some(p => p.id === PANE)) {
      isOpen = true
      void poll($)
    }
    return next(e)
  })

  on('command.run', { command: 'github' }, async $ => {
    await $.ui.open({ id: PANE, title: 'GitHub' })
    isOpen = true
    void poll($)
    return { text: 'GitHub pane opened.' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    isOpen = false
    timer?.cancel()
    timer = null
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const [s, t, sel, det, work, armed] = await Promise.all([read($, snap), read($, tab), read($, selected), read($, detail), read($, busy), read($, confirm)])
    const rows = s.rows[t]
    const pick = (key: string | null) => Promise.all([update($, selected, () => key), update($, detail, () => null), update($, confirm, () => null)])
    const merge = async (r: Row) => {
      const c = confirmPress(armed, r.key)
      await update($, confirm, () => c.armed)
      if (!c.run) return update($, detail, () => `Press m again to squash-merge #${r.id} and delete its branch.`)
      return act($, `Merge #${r.id}`, ['pr', 'merge', String(r.id), '--squash', '--delete-branch'], o => o.trim() || `Merged #${r.id}`)
    }
    const time = s.at ? new Date(s.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null

    const actions = (r: Row) => (
      <Box key={`act-${r.key}`} flexDirection="row" flexWrap="wrap" columnGap={2} paddingLeft={4}>
        <Link href={r.url}>Open on GitHub</Link>
        {r.kind === 'pr' ? (
          <Button key="checkout" hotkey="c" onPress={() => act($, `Checkout #${r.id}`, ['pr', 'checkout', String(r.id)], o => o.trim() || `Checked out #${r.id}`)}>Checkout</Button>
        ) : null}
        {r.kind === 'pr' ? (
          <Button key="details" hotkey="d" onPress={() => act($, `Details #${r.id}`, ['pr', 'view', String(r.id), '--json', DETAIL_FIELDS], o => prDetail(JSON.parse(o)), false)}>Details</Button>
        ) : null}
        {r.kind === 'pr' && viewer && r.author !== viewer ? (
          <Button key="approve" hotkey="a" onPress={() => act($, `Approve #${r.id}`, ['pr', 'review', String(r.id), '--approve'], o => o.trim() || `Approved #${r.id}`)}>Approve</Button>
        ) : null}
        {r.kind === 'pr' && r.isDraft ? (
          <Button key="ready" hotkey="y" onPress={() => act($, `Ready #${r.id}`, ['pr', 'ready', String(r.id)], o => o.trim() || `#${r.id} marked ready for review`)}>Ready</Button>
        ) : null}
        {r.kind === 'pr' ? (
          <Button key="merge" hotkey="m" variant={armed === r.key ? 'primary' : 'secondary'} onPress={() => merge(r)}>{armed === r.key ? 'Confirm merge' : 'Merge'}</Button>
        ) : null}
        {r.kind === 'run' && r.isFailed ? (
          <Button key="rerun" hotkey="x" onPress={() => act($, 'Rerun', ['run', 'rerun', String(r.id), '--failed'], () => `Rerunning failed jobs of run ${r.id}`)}>Rerun failed</Button>
        ) : null}
        {r.kind === 'run' && r.isFailed ? (
          <Button key="log" hotkey="l" onPress={() => act($, 'Failed log', ['run', 'view', String(r.id), '--log-failed'], o => logTail(o) || 'No failed-step log.')}>Failed log</Button>
        ) : null}
        {r.kind === 'pr' && r.isFailed ? (
          <Button key="prchecks" hotkey="l" onPress={() => act($, 'Checks', ['pr', 'checks', String(r.id)], o => o.trim())}>Show checks</Button>
        ) : null}
      </Box>
    )

    const rowView = (r: Row) => (
      <Box key={r.key} flexDirection="column">
        <Button key={`row-${r.key}`} plain onPress={() => pick(sel === r.key ? null : r.key)}>
          <Text color={r.tone}>{`${sel === r.key ? '▸' : ' '} ${r.glyph} `}</Text>
          <Text weight={sel === r.key ? 'bold' : 'regular'}>{r.title}</Text>
          <Text dimColor>{`  ${r.sub} · ${r.age}`}</Text>
        </Button>
        {sel === r.key ? actions(r) : null}
      </Box>
    )

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="row" justifyContent="space-between" flexWrap="wrap" columnGap={2}>
          <Text weight="bold">{s.repo ?? 'GitHub'}</Text>
          <Box flexDirection="row" columnGap={2}>
            <Text dimColor size="caption">{work ? `${work}…` : time ? `updated ${time} · ${timer ? `every ${delay / 1000}s` : 'paused, press r'}` : 'loading…'}</Text>
            <Button key="refresh" hotkey="r" plain onPress={() => poll($)}>↻ Refresh</Button>
          </Box>
        </Box>

        {s.repo && s.at ? (
          <Box key="here" flexDirection="column">
            <Text dimColor size="caption">This branch</Text>
            {s.here ? rowView(s.here) : <Text dimColor>  No PR for this branch.</Text>}
          </Box>
        ) : null}

        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {TABS.map(([id, label], i) => (
            <Button key={`tab-${id}`} hotkey={String(i + 1)} variant={id === t ? 'primary' : 'secondary'}
              onPress={() => Promise.all([update($, tab, () => id), pick(null)])}>
              {`${label} ${s.rows[id].length}`}
            </Button>
          ))}
        </Box>

        {s.error ? <Text color="error">{s.repo ? `Refresh failed: ${s.error}` : `No GitHub repo here (${s.error}). Run /github from a cloned repo with gh signed in.`}</Text> : null}

        <Box flexDirection="column">
          {rows.length === 0 && s.at ? <Text dimColor>{t === 'mine' ? 'Nothing waiting on you.' : 'Nothing here.'}</Text> : null}
          {rows.map(rowView)}
        </Box>

        {det ? (
          <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
            <Text mono wrap="wrap">{det}</Text>
            <Button key="close-detail" plain dimColor onPress={() => Promise.all([update($, detail, () => null), update($, confirm, () => null)])}>Close</Button>
          </Box>
        ) : null}
      </Box>
    )
  })
}
