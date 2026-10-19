import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Row, Snapshot, Tab } from '../types'
import { issueRow, logTail, newlyFailed, prRow, runRow } from './format'

const PANE = 'github-pane'
const EVERY_MS = 60_000
const TABS: [Tab, string][] = [['prs', 'Pull requests'], ['checks', 'Checks'], ['issues', 'Issues'], ['mine', 'For me']]
const PR_FIELDS = 'number,title,author,isDraft,headRefName,baseRefName,reviewDecision,statusCheckRollup,updatedAt,url'
const ISSUE_FIELDS = 'number,title,labels,assignees,updatedAt,url'
const EMPTY: Snapshot = { repo: null, rows: { prs: [], checks: [], issues: [], mine: [] }, at: 0, error: null }

const snap = atom({ plugin: 'github-pane', key: 'snap' } as const, EMPTY)
const tab = atom({ plugin: 'github-pane', key: 'tab' } as const, 'prs' as Tab)
const selected = atom({ plugin: 'github-pane', key: 'selected' } as const, null as string | null)
const detail = atom({ plugin: 'github-pane', key: 'detail' } as const, null as string | null)
const busy = atom({ plugin: 'github-pane', key: 'busy' } as const, null as string | null)

type $ = EngineInterface

async function gh($: $, args: string[], timeoutMs = 30_000) {
  const r = await $.process.run(['gh', ...args], { timeoutMs })
  if (r.exitCode !== 0) throw new Error(r.stderr.trim().split('\n')[0] || `gh exited ${r.exitCode}`)
  return r.stdout
}
const ghJson = async ($: $, args: string[]) => JSON.parse(await gh($, args))

let prevChecks: Map<number, boolean> | null = null // ponytail: module variable, resets on reload (no toast storm)
let isRefreshing = false

async function refresh($: $) {
  if (isRefreshing) return
  isRefreshing = true
  try {
    const repo = (await ghJson($, ['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner as string
    const now = await $.clock.now()
    const [prs, runs, issues, review, authored, assigned] = await Promise.all([
      ghJson($, ['pr', 'list', '-L', '30', '--json', PR_FIELDS]),
      ghJson($, ['run', 'list', '-L', '20', '--json', 'databaseId,displayTitle,status,conclusion,workflowName,headBranch,event,createdAt,url']),
      ghJson($, ['issue', 'list', '-L', '30', '--json', ISSUE_FIELDS]),
      ghJson($, ['pr', 'list', '--search', 'review-requested:@me', '--json', PR_FIELDS]),
      ghJson($, ['pr', 'list', '--author', '@me', '--json', PR_FIELDS]),
      ghJson($, ['issue', 'list', '--assignee', '@me', '--json', ISSUE_FIELDS]),
    ])
    const prRows = prs.map((p: any) => prRow(p, now))
    const mine = [...review, ...authored].map((p: any) => prRow(p, now))
      .filter((r: Row, i: number, all: Row[]) => all.findIndex(x => x.key === r.key) === i)
      .concat(assigned.map((i: any) => issueRow(i, now)))

    for (const r of newlyFailed(prevChecks, prRows)) $.ui.toast(`✗ Checks failed on #${r.id}: ${r.title}`, { timeoutMs: 10_000 })
    prevChecks = new Map(prRows.map((r: Row) => [r.id, r.isFailed]))

    await update($, snap, () => ({
      repo,
      rows: { prs: prRows, checks: runs.map((r: any) => runRow(r, now)), issues: issues.map((i: any) => issueRow(i, now)), mine },
      at: now,
      error: null,
    }))
  } catch (err: any) {
    const at = await $.clock.now()
    await update($, snap, s => ({ ...s, at, error: String(err?.message ?? err) }))
  } finally {
    isRefreshing = false
  }
}

// Runs a row action, shows its output (or error) in the detail box.
async function act($: $, label: string, args: string[], show: (out: string) => string) {
  await update($, busy, () => label)
  try {
    const out = await gh($, args, 120_000)
    await update($, detail, () => show(out))
    void refresh($)
  } catch (err: any) {
    await update($, detail, () => `${label} failed: ${err?.message ?? err}`)
  } finally {
    await update($, busy, () => null)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'github', description: 'Open the GitHub pane for this repo' })
    void refresh($)
    $.clock.every(EVERY_MS, () => void refresh($))
    return next(e)
  })

  on('command.run', { command: 'github' }, async $ => {
    await $.ui.open({ id: PANE, title: 'GitHub' })
    void refresh($)
    return { text: 'GitHub pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const [s, t, sel, det, work] = await Promise.all([read($, snap), read($, tab), read($, selected), read($, detail), read($, busy)])
    const rows = s.rows[t]
    const pick = (key: string | null) => Promise.all([update($, selected, () => key), update($, detail, () => null)])
    const time = s.at ? new Date(s.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null

    const actions = (r: Row) => (
      <Box key={`act-${r.key}`} flexDirection="row" flexWrap="wrap" columnGap={2} paddingLeft={4}>
        <Link href={r.url}>Open on GitHub</Link>
        {r.kind === 'pr' ? (
          <Button key="checkout" hotkey="c" onPress={() => act($, `Checkout #${r.id}`, ['pr', 'checkout', String(r.id)], o => o.trim() || `Checked out #${r.id}`)}>Checkout</Button>
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

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="row" justifyContent="space-between" flexWrap="wrap" columnGap={2}>
          <Text weight="bold">{s.repo ?? 'GitHub'}</Text>
          <Box flexDirection="row" columnGap={2}>
            <Text dimColor size="caption">{work ? `${work}…` : time ? `updated ${time} · every ${EVERY_MS / 1000}s` : 'loading…'}</Text>
            <Button key="refresh" hotkey="r" plain onPress={() => refresh($)}>↻ Refresh</Button>
          </Box>
        </Box>

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
          {rows.map(r => (
            <Box key={r.key} flexDirection="column">
              <Button key={`row-${r.key}`} plain onPress={() => pick(sel === r.key ? null : r.key)}>
                <Text color={r.tone}>{`${sel === r.key ? '▸' : ' '} ${r.glyph} `}</Text>
                <Text weight={sel === r.key ? 'bold' : 'regular'}>{r.title}</Text>
                <Text dimColor>{`  ${r.sub} · ${r.age}`}</Text>
              </Button>
              {sel === r.key ? actions(r) : null}
            </Box>
          ))}
        </Box>

        {det ? (
          <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
            <Text mono wrap="wrap">{det}</Text>
            <Button key="close-detail" hotkey="escape" plain dimColor onPress={() => update($, detail, () => null)}>Close</Button>
          </Box>
        ) : null}
      </Box>
    )
  })
}
