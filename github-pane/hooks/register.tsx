import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Detail, PrParts, Row, Snapshot, Tab, Tone } from '../types'
import type { Pill, Seen } from './format'
import { confirmPress, desktopRow, failedRunId, fixPrompt, issueRow, logTail, nextDelay, notifRow, prDetail, prRow, prText, runRow, toasts } from './format'

const PANE = 'github-pane'
const EVERY_MS = 60_000
const TABS: [Tab, string][] = [['prs', 'Pull requests'], ['checks', 'Checks'], ['issues', 'Issues'], ['mine', 'For me'], ['notifs', 'Notifications']]
const DETAIL_FIELDS = 'body,reviewRequests,latestReviews,mergeable,mergeStateStatus,additions,deletions,changedFiles'
const PR_FIELDS = 'number,title,author,isDraft,headRefName,baseRefName,reviewDecision,statusCheckRollup,updatedAt,url'
const ISSUE_FIELDS = 'number,title,labels,assignees,updatedAt,url'
// shortcut: raw translucent tints read on light and dark; swap for theme keys if the desktop theme gets row-tint ones
const HOVER_BG = 'rgba(127,127,127,0.12)'
const SELECTED_BG = 'rgba(70,120,220,0.16)'
const PILL_BG: Record<Tone, string> = { success: 'rgba(46,160,67,0.2)', error: 'rgba(218,54,51,0.2)', warning: 'rgba(210,153,34,0.22)', subtle: 'rgba(127,127,127,0.2)' }
const EMPTY: Snapshot = { repo: null, rows: { prs: [], checks: [], issues: [], mine: [], notifs: [] }, here: null, at: 0, error: null }

const snap = atom({ plugin: 'github-pane', key: 'snap' } as const, EMPTY)
const tab = atom({ plugin: 'github-pane', key: 'tab' } as const, 'prs' as Tab)
const selected = atom({ plugin: 'github-pane', key: 'selected' } as const, null as string | null)
const detail = atom({ plugin: 'github-pane', key: 'detail' } as const, null as Detail | null)
const busy = atom({ plugin: 'github-pane', key: 'busy' } as const, null as string | null)
const confirm = atom({ plugin: 'github-pane', key: 'confirm' } as const, null as string | null) // row key armed for merge

type $ = EngineInterface

async function gh($: $, args: string[], timeoutMs = 30_000) {
  const r = await $.process.run(['gh', ...args], { timeoutMs })
  // gh pr checks exits 1 or 8 on failing or pending checks; its stdout is still the answer
  const isChecks = args[0] === 'pr' && args[1] === 'checks' && !!r.stdout.trim()
  if (r.exitCode !== 0 && !isChecks) throw new Error(r.stderr.trim().split('\n')[0] || `gh exited ${r.exitCode}`)
  return r.stdout
}
const ghJson = async ($: $, args: string[]) => JSON.parse(await gh($, args))

let prevSeen: Seen | null = null // ponytail: module variable, resets on reload (no toast storm)
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
    const [prs, runs, issues, review, authored, assigned, status, login, notifs] = await Promise.all([
      ghJson($, ['pr', 'list', '-L', '30', '--json', PR_FIELDS]),
      ghJson($, ['run', 'list', '-L', '20', '--json', 'databaseId,displayTitle,status,conclusion,workflowName,headBranch,event,createdAt,url']),
      ghJson($, ['issue', 'list', '-L', '30', '--json', ISSUE_FIELDS]),
      ghJson($, ['pr', 'list', '--search', 'review-requested:@me', '--json', PR_FIELDS]),
      ghJson($, ['pr', 'list', '--author', '@me', '--json', PR_FIELDS]),
      ghJson($, ['issue', 'list', '--assignee', '@me', '--json', ISSUE_FIELDS]),
      ghJson($, ['pr', 'status', '--json', PR_FIELDS]).catch(() => null), // detached HEAD etc.: no header, not an error
      viewer ?? gh($, ['api', 'user', '-q', '.login']).then(o => o.trim() || null, () => null),
      ghJson($, ['api', `repos/${repo}/notifications`]).catch(() => []), // token without notifications scope: empty tab, not an error
    ])
    viewer = login
    const cur = status?.currentBranch
    const prRows = prs.map((p: any) => prRow(p, now))
    const runRows = runs.map((r: any) => runRow(r, now))
    const asked: Row[] = review.map((p: any) => prRow(p, now))
    const yours: Row[] = authored.map((p: any) => prRow(p, now))
    const mine = [...asked, ...yours]
      .filter((r: Row, i: number, all: Row[]) => all.findIndex(x => x.key === r.key) === i)
      .concat(assigned.map((i: any) => issueRow(i, now)))

    // ponytail: "your runs" = runs on your open PRs' branches; add `--user <login>` if pushes without a PR matter
    const branches = new Set(authored.map((p: any) => p.headRefName))
    const seen: Seen = { prs: prRows, asked, authored: yours, runs: runs.flatMap((r: any, i: number) => branches.has(r.headBranch) ? [runRows[i]] : []) }
    for (const t of toasts(prevSeen, seen)) $.ui.toast(t, { timeoutMs: 10_000 })
    prevSeen = seen

    await update($, snap, () => ({
      repo,
      rows: { prs: prRows, checks: runRows, issues: issues.map((i: any) => issueRow(i, now)), mine, notifs: notifs.map((n: any) => notifRow(n, now)) },
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
async function act($: $, label: string, args: string[], show: (out: string) => string | Detail, refreshAfter = true) {
  await update($, busy, () => label)
  try {
    const out = await gh($, args, 120_000)
    const d = show(out)
    await update($, detail, () => typeof d === 'string' ? { text: d } : d)
    if (refreshAfter) void poll($)
  } catch (err: any) {
    await update($, detail, () => ({ text: `${label} failed: ${err?.message ?? err}` }))
  } finally {
    await update($, busy, () => null)
  }
}

// Fills the prompt box with a failed run's log and a fix request; never sends it.
async function fix($: $, r: Row) {
  await update($, busy, () => `Fix #${r.id}`)
  try {
    let runId: number | null = r.id
    if (r.kind === 'pr') {
      // gh exits non-zero when checks fail, so read stdout directly
      const c = await $.process.run(['gh', 'pr', 'checks', String(r.id), '--json', 'link,state'], { timeoutMs: 30_000 })
      runId = failedRunId(JSON.parse(c.stdout || '[]'))
      if (!runId) throw new Error('no failed GitHub Actions run on this PR')
    }
    const log = await gh($, ['run', 'view', String(runId), '--log-failed'], 120_000)
    const res = await $.prompt.fill({ text: fixPrompt(r, runId, log) })
    await update($, detail, () => ({ text: res.isFilled ? 'Fix request is in the prompt box: edit it, then press Enter to send.' : `Couldn't fill the prompt box${res.refusal ? ` (${res.refusal})` : ''}.` }))
  } catch (err: any) {
    await update($, detail, () => ({ text: `Fix failed: ${err?.message ?? err}` }))
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
    const { Box, Text, Button, Link, Code, Markdown } = $.ui.resolve(e)
    const isApp = e.surface !== 'terminal' // the terminal keeps its tree; its element table has Markdown too
    const [s, t, sel, det, work, armed] = await Promise.all([read($, snap), read($, tab), read($, selected), read($, detail), read($, busy), read($, confirm)])
    const rows = s.rows[t]
    const pick = (key: string | null) => Promise.all([update($, selected, () => key), update($, detail, () => null), update($, confirm, () => null)])
    const merge = async (r: Row) => {
      const c = confirmPress(armed, r.key)
      await update($, confirm, () => c.armed)
      if (!c.run) return update($, detail, () => ({ text: `Press m again to squash-merge #${r.id} and delete its branch.` }))
      return act($, `Merge #${r.id}`, ['pr', 'merge', String(r.id), '--squash', '--delete-branch'], o => o.trim() || `Merged #${r.id}`)
    }
    const time = s.at ? new Date(s.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null

    const actions = (r: Row) => (
      <Box key={`act-${r.key}`} flexDirection="row" flexWrap="wrap" columnGap={2} rowGap="xs" paddingLeft={isApp ? 0 : 4} alignItems="center">
        <Link href={r.url}>Open on GitHub</Link>
        {r.kind === 'pr' ? (
          <Button key="checkout" hotkey="c" onPress={() => act($, `Checkout #${r.id}`, ['pr', 'checkout', String(r.id)], o => o.trim() || `Checked out #${r.id}`)}>Checkout</Button>
        ) : null}
        {r.kind === 'pr' ? (
          <Button key="details" hotkey="d" onPress={() => act($, `Details #${r.id}`, ['pr', 'view', String(r.id), '--json', DETAIL_FIELDS], o => { const pr = prDetail(JSON.parse(o)); return { text: prText(pr), pr } }, false)}>Details</Button>
        ) : null}
        {r.kind === 'pr' && viewer && r.author !== viewer ? (
          <Button key="approve" hotkey="a" onPress={() => act($, `Approve #${r.id}`, ['pr', 'review', String(r.id), '--approve'], o => o.trim() || `Approved #${r.id}`)}>Approve</Button>
        ) : null}
        {r.kind === 'pr' && r.isDraft ? (
          <Button key="ready" hotkey="y" onPress={() => act($, `Ready #${r.id}`, ['pr', 'ready', String(r.id)], o => o.trim() || `#${r.id} marked ready for review`)}>Ready</Button>
        ) : null}
        {r.kind === 'pr' ? (
          <Button key="merge" hotkey="m" variant={isApp || armed === r.key ? 'primary' : 'secondary'} onPress={() => merge(r)}>{armed === r.key ? 'Confirm merge' : 'Merge'}</Button>
        ) : null}
        {r.kind === 'run' && r.isFailed ? (
          <Button key="rerun" hotkey="x" variant={isApp ? 'primary' : undefined} onPress={() => act($, 'Rerun', ['run', 'rerun', String(r.id), '--failed'], () => `Rerunning failed jobs of run ${r.id}`)}>Rerun failed</Button>
        ) : null}
        {r.kind === 'run' && r.isFailed ? (
          <Button key="log" hotkey="l" onPress={() => act($, 'Failed log', ['run', 'view', String(r.id), '--log-failed'], o => { const t = logTail(o); return { text: t || 'No failed-step log.', code: !!t } })}>Failed log</Button>
        ) : null}
        {(r.kind === 'run' || r.kind === 'pr') && r.isFailed ? (
          <Button key="fix" hotkey="f" onPress={() => fix($, r)}>Fix with Claude</Button>
        ) : null}
        {r.kind === 'notif' ? (
          <Button key="read" hotkey="e" onPress={() => act($, 'Mark read', ['api', '-X', 'PATCH', `notifications/threads/${r.id}`], () => 'Marked read')}>Mark read</Button>
        ) : null}
        {r.kind === 'pr' && r.isFailed ? (
          <Button key="prchecks" hotkey="l" onPress={() => act($, 'Checks', ['pr', 'checks', String(r.id)], o => ({ text: o.trim(), code: true }))}>Show checks</Button>
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

    const closeDetail = () => Promise.all([update($, detail, () => null), update($, confirm, () => null)])
    const prParts = (d: PrParts) => (
      <Box key="pr-parts" flexDirection="column" rowGap={1}>
        {d.reviewers.length ? (
          <Box key="reviewers" flexDirection="column">
            {d.reviewers.map(v => (
              <Box key={`rev-${v.who}`} flexDirection="row" columnGap={1}>
                <Text size="caption">{v.who}</Text>
                {pill({ text: v.text, tone: v.tone })}
              </Box>
            ))}
          </Box>
        ) : <Text size="caption" dimColor>No reviewers.</Text>}
        {d.body ? <Markdown key="pr-body" text={d.body} /> : <Text dimColor>No description.</Text>}
      </Box>
    )
    // Desktop detail: header (PR stat line, icon close), then the PR parts, a code block or plain text.
    const appDetail = (d: Detail) => (
      <Box key="detail" flexDirection="column" rowGap="xs" paddingTop="xs">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1}>
          <Text size="caption" dimColor tabular wrap="truncate-end">{d.pr ? `${d.pr.stat} · ${d.pr.merge}` : ''}</Text>
          <Button key="close-detail" label="Close details" plain dimColor onPress={closeDetail}>✕</Button>
        </Box>
        {d.pr ? prParts(d.pr) : d.code ? <Code source={d.text} wrap="wrap" /> : <Text wrap="wrap">{d.text}</Text>}
      </Box>
    )

    const pill = (p: Pill) => <Text key={`pill-${p.text}`} size="caption" backgroundColor={PILL_BG[p.tone]} color={p.tone}>{` ${p.text} `}</Text>
    const appRowView = (r: Row) => {
      const d = desktopRow(r)
      return (
        <Box key={r.key} flexDirection="column" backgroundColor={sel === r.key ? SELECTED_BG : undefined}>
          <Box key={`box-${r.key}`} flexDirection="column" paddingX={1} paddingY="xs" hover={{ backgroundColor: sel === r.key ? SELECTED_BG : HOVER_BG }}>
            <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
              {/* glyph outside the Button: the desktop draws a Button's label in one colour */}
              <Box flexDirection="row" columnGap={1}>
                <Text color={r.tone}>{r.glyph}</Text>
                <Button key={`row-${r.key}`} plain onPress={() => pick(sel === r.key ? null : r.key)}>
                  <Text weight="medium" wrap="truncate-end">{d.title}</Text>
                </Button>
              </Box>
              <Text size="caption" dimColor tabular>{r.age}</Text>
            </Box>
            <Box flexDirection="row" columnGap={1} paddingLeft={2}>
              <Text size="caption" dimColor wrap="truncate-end">{d.meta}</Text>
              {d.pills.map(pill)}
            </Box>
          </Box>
          {sel === r.key ? (
            <Box key={`card-${r.key}`} flexDirection="column" rowGap={1} borderStyle="round" borderColor="subtle" paddingX={1} marginX={1} marginBottom="xs">
              {det ? appDetail(det) : null}
              {actions(r)}
            </Box>
          ) : null}
        </Box>
      )
    }
    const row = isApp ? appRowView : rowView
    const status = work ? `${work}…` : time ? `updated ${time} · ${timer ? `every ${delay / 1000}s` : 'paused, press r'}` : 'loading…'
    const errorText = s.error ? (s.repo ? `Refresh failed: ${s.error}` : `No GitHub repo here (${s.error}). Run /github from a cloned repo with gh signed in.`) : null

    return (
      <Box flexDirection="column" rowGap={1}>
        {isApp ? (
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={2}>
            <Box flexDirection="column">
              <Text size="heading" weight="semibold" wrap="truncate-end">{s.repo ?? 'GitHub'}</Text>
              <Text dimColor size="caption">{status}</Text>
            </Box>
            <Button key="refresh" hotkey="r" plain onPress={() => poll($)}>Refresh</Button>
          </Box>
        ) : (
          <Box flexDirection="row" justifyContent="space-between" flexWrap="wrap" columnGap={2}>
            <Text weight="bold">{s.repo ?? 'GitHub'}</Text>
            <Box flexDirection="row" columnGap={2}>
              <Text dimColor size="caption">{status}</Text>
              <Button key="refresh" hotkey="r" plain onPress={() => poll($)}>↻ Refresh</Button>
            </Box>
          </Box>
        )}

        {s.repo && s.at ? (
          <Box key="here" flexDirection="column">
            <Text dimColor size="caption">This branch</Text>
            {s.here ? row(s.here) : <Text dimColor>{isApp ? 'No PR for this branch.' : '  No PR for this branch.'}</Text>}
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

        {errorText && isApp ? (
          <Box borderStyle="round" borderColor="error" paddingX={1}><Text color="error" wrap="wrap">{errorText}</Text></Box>
        ) : errorText ? <Text color="error">{errorText}</Text> : null}

        <Box flexDirection="column">
          {rows.length === 0 && s.at ? <Text dimColor>{t === 'mine' ? 'Nothing waiting on you.' : t === 'notifs' ? 'No unread notifications.' : 'Nothing here.'}</Text> : null}
          {rows.map(row)}
        </Box>

        {det && isApp && !(s.here?.key === sel || rows.some(r => r.key === sel)) ? (
          <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>{appDetail(det)}</Box>
        ) : det && !isApp ? (
          <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
            <Text mono wrap="wrap">{det.text}</Text>
            <Button key="close-detail" plain dimColor onPress={closeDetail}>Close</Button>
          </Box>
        ) : null}
      </Box>
    )
  })
}
