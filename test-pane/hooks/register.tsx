import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Framework, Result, Run, TestResult } from '../types'
import { age, countLine, detect, exitCode, fixPrompt, isFlaky, parse, rerunCommand, summary, tail, testKey } from './parse'

const PANE = 'test-pane'
const MAX_RUNS = 30
const MAX_HISTORY = 12 // outcomes kept per test
const RUN_TIMEOUT_MS = 600_000
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
// shortcut: raw translucent tints read on light and dark, as in github-pane
const SELECTED_BG = 'rgba(70,120,220,0.16)'
const HOVER_BG = 'rgba(127,127,127,0.12)'
const FLAKY_BG = 'rgba(210,153,34,0.22)'

// Change a shape tag when that value's fields change: it declines what an earlier version stored.
const runs = atom({ plugin: 'test-pane', key: 'runs' } as const, [] as Run[], { shape: 'runs-1' })
const history = atom({ plugin: 'test-pane', key: 'history' } as const, {} as Record<string, Result[]>, { shape: 'history-1' })
const editSeq = atom({ plugin: 'test-pane', key: 'editSeq' } as const, 0)
const selected = atom({ plugin: 'test-pane', key: 'selected' } as const, null as number | null)
const showPassed = atom({ plugin: 'test-pane', key: 'showPassed' } as const, false)
const showOutput = atom({ plugin: 'test-pane', key: 'showOutput' } as const, false)
const busy = atom({ plugin: 'test-pane', key: 'busy' } as const, null as string | null)
const note = atom({ plugin: 'test-pane', key: 'note' } as const, null as string | null)
const dismissed = atom({ plugin: 'test-pane', key: 'dismissed' } as const, false) // closed by hand: no auto-open

type $ = EngineInterface

let cwd = '/' // the session's folder; the pane reruns there

async function open($: $) {
  await update($, dismissed, () => false)
  return $.ui.open({ id: PANE, title: 'Tests' })
}

// Records a finished run: the run list, each test's history, and toasts for tests that just turned flaky.
async function record($: $, command: string, framework: Framework, output: string, code: number | null, startedAt: number, byPane: boolean) {
  const now = await $.clock.now()
  const tests: TestResult[] = parse(output)
  const counted = tests.length ? null : summary(output)
  const seq = await read($, editSeq)
  const prev = await read($, runs)
  const run: Run = {
    id: (prev.at(-1)?.id ?? 0) + 1,
    command,
    framework,
    at: now,
    durationMs: now - startedAt,
    exitCode: code,
    tests,
    passed: counted?.passed ?? tests.filter(t => t.status === 'pass').length,
    failed: counted?.failed ?? tests.filter(t => t.status === 'fail').length,
    skipped: counted?.skipped ?? tests.filter(t => t.status === 'skip').length,
    output: tail(output),
    byPane,
  }
  const before = await read($, history)
  const after: Record<string, Result[]> = { ...before }
  for (const t of tests) {
    const k = testKey(framework, t.name)
    after[k] = [...(after[k] ?? []), { run: run.id, status: t.status, editSeq: seq }].slice(-MAX_HISTORY)
  }
  const turned = tests.filter(t => isFlaky(after[testKey(framework, t.name)]) && !isFlaky(before[testKey(framework, t.name)]))
  await update($, history, () => after)
  await update($, runs, list => [...list, run].slice(-MAX_RUNS))
  await update($, selected, () => run.id)
  for (const t of turned.slice(0, 3)) $.ui.toast(`Flaky test: ${t.name} passed and failed with no edits in between`, { timeoutMs: 10_000 })
  return run
}

// Runs a command from the pane in the session's folder and records it like Claude's own runs.
async function rerun($: $, label: string, command: string, framework: Framework) {
  if (await read($, busy)) return
  await Promise.all([update($, busy, () => label), update($, note, () => null)])
  const start = await $.clock.now()
  try {
    const r = await $.process.run(['bash', '-lc', command], { cwd, timeoutMs: RUN_TIMEOUT_MS })
    const run = await record($, command, framework, `${r.stdout}\n${r.stderr}`, r.exitCode, start, true)
    await update($, note, () => `${label}: ${countLine(run)}`)
  } catch (err: any) {
    await update($, note, () => `${label} failed to start: ${err?.message ?? err}`)
  } finally {
    await update($, busy, () => null)
  }
}

const failedOf = (run: Run) => run.tests.filter(t => t.status === 'fail').map(t => t.name)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    cwd = e.cwd ?? cwd
    await $.command.register({ name: 'tests', description: 'Open the test pane: the test runs of this session' })
    return next(e)
  })

  on('command.run', { command: 'tests' }, async $ => {
    await open($)
    return { text: 'Test pane opened.' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    await update($, dismissed, () => true)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (EDIT_TOOLS.has(e.tool)) {
      const r = await next(e)
      if (!r.deny && !r.isError) await update($, editSeq, n => n + 1)
      return r
    }
    if (e.tool !== 'Bash') return next(e)

    const command = String(e.command ?? '')
    const framework = detect(command)
    if (!framework || e.run_in_background) {
      const r = await next(e)
      // a command that may write files (sed -i, git checkout, npm install) counts as an edit
      if (!framework && !r.deny && !r.isReadOnly) await update($, editSeq, n => n + 1)
      return r
    }

    const start = await $.clock.now()
    const r = await next(e)
    if (r.deny) return r
    const text = r.text ?? ''
    await record($, command, framework, text, exitCode(text, !!r.isError), start, false)
    if (!(await read($, dismissed)) && !(await $.ui.panes()).some(p => p.id === PANE)) void open($)
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Code = 'Code' in els ? els.Code : null
    const isApp = e.surface !== 'terminal'
    const [list, hist, sel, passedOpen, outputOpen, work, msg] = await Promise.all([
      read($, runs), read($, history), read($, selected), read($, showPassed), read($, showOutput), read($, busy), read($, note),
    ])
    const now = await $.clock.now()

    if (!list.length) {
      return (
        <Box flexDirection="column" rowGap={1} padding={isApp ? 1 : 0}>
          <Text weight="semibold">No test runs yet</Text>
          <Text dimColor wrap="wrap">
            Tests Claude runs through Bash show up here: pytest, jest, vitest, go test, cargo test, node --test, mocha, bun and deno test, and npm/pnpm/yarn test scripts.
          </Text>
        </Box>
      )
    }

    const run = list.find(r => r.id === sel) ?? list.at(-1)!
    const flakyNames = new Set(run.tests.filter(t => isFlaky(hist[testKey(run.framework, t.name)])).map(t => t.name))
    const failed = failedOf(run)
    const passed = run.tests.filter(t => t.status === 'pass')
    const skipped = run.tests.filter(t => t.status === 'skip')
    const again = rerunCommand(run, failed)
    const sessionFlaky = Object.entries(hist).filter(([, h]) => isFlaky(h)).map(([k]) => k.slice(k.indexOf(':') + 1))
    const tone = (r: Run) => (r.failed > 0 || (r.exitCode ?? 1) !== 0 ? 'error' : 'success')
    const glyph = (r: Run) => (tone(r) === 'error' ? '✗' : '✓')
    const secs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)

    const fix = async () => {
      const res = await $.prompt.fill({ text: fixPrompt(run, failed, [...flakyNames]) })
      await update($, note, () => (res.isFilled ? 'Fix request is in the prompt box: edit it, then press Enter to send.' : "Couldn't fill the prompt box."))
    }

    const runRow = (r: Run) => {
      const isSel = r.id === run.id
      return (
        <Box key={`run-${r.id}`} flexDirection="row" columnGap={1} paddingX={isApp ? 1 : 0}
          backgroundColor={isApp && isSel ? SELECTED_BG : undefined} hover={isApp ? { backgroundColor: isSel ? SELECTED_BG : HOVER_BG } : undefined}>
          <Box width={2}><Text color={tone(r)}>{glyph(r)}</Text></Box>
          <Button key={`pick-${r.id}`} plain onPress={() => Promise.all([update($, selected, () => r.id), update($, showOutput, () => false)])}>
            <Text weight={isSel ? 'semibold' : 'regular'} wrap="truncate-end">{`${!isApp && isSel ? '▸ ' : ''}${r.command}`}</Text>
          </Button>
          <Text size="caption" dimColor tabular wrap="truncate-end">{`${countLine(r)} · ${age(r.at, now)}${r.byPane ? ' · pane' : ''}`}</Text>
        </Box>
      )
    }

    const testRow = (t: TestResult) => (
      <Box flexDirection="row" columnGap={1} paddingLeft={isApp ? 1 : 2}>
        <Box width={2}><Text color={t.status === 'fail' ? 'error' : t.status === 'pass' ? 'success' : 'subtle'}>{t.status === 'fail' ? '✗' : t.status === 'pass' ? '✓' : '○'}</Text></Box>
        <Text wrap="truncate-end" mono={!isApp}>{t.name}</Text>
        {flakyNames.has(t.name) ? (
          isApp ? <Text size="caption" color="warning" backgroundColor={FLAKY_BG}>{' flaky '}</Text> : <Text color="warning">[flaky]</Text>
        ) : null}
      </Box>
    )

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" columnGap={2}>
          <Box flexDirection="column">
            <Text size="heading" weight="semibold" color={tone(run)}>{failed.length ? `${failed.length} failing` : run.failed ? `${run.failed} failing` : tone(run) === 'error' ? 'Run failed' : 'All passing'}</Text>
            <Text size="caption" dimColor>{work ? `${work}…` : `${run.framework} · ${secs(run.durationMs)} · ${age(run.at, now)} ago`}</Text>
          </Box>
          <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap="xs">
            {again ? <Button key="rerun-failed" hotkey="x" variant="primary" onPress={() => rerun($, `Rerun ${failed.length} failed`, again, run.framework)}>Rerun failed</Button> : null}
            <Button key="rerun-all" hotkey="a" onPress={() => rerun($, 'Rerun all', run.command, run.framework)}>Rerun all</Button>
            {tone(run) === 'error' ? <Button key="fix" hotkey="f" onPress={fix}>Fix with Claude</Button> : null}
          </Box>
        </Box>

        {msg ? <Text size="caption" wrap="wrap" color={/failed to start|Couldn't/.test(msg) ? 'error' : undefined}>{msg}</Text> : null}
        {failed.length && !again ? <Text size="caption" dimColor wrap="wrap">{`No per-test filter known for ${run.framework}: Rerun all runs the whole command.`}</Text> : null}

        <Box flexDirection="column" borderStyle={isApp ? 'round' : undefined} borderColor="subtle" paddingY={isApp ? 'xs' : 0}>
          <Text size="caption" dimColor>{`  ${run.command}`}</Text>
          {run.tests.length === 0 ? <Text dimColor wrap="wrap">{`  ${countLine(run)}. No per-test lines found; see the output.`}</Text> : null}
          {run.tests.filter(t => t.status === 'fail').map(testRow)}
          {skipped.length ? <Text size="caption" dimColor>{`   ${skipped.length} skipped`}</Text> : null}
          {passed.length ? (
            <Button key="toggle-passed" hotkey="p" plain dimColor onPress={() => update($, showPassed, v => !v)}>
              {`${passedOpen ? '▾' : '▸'} ${passed.length} passed`}
            </Button>
          ) : null}
          {passedOpen ? passed.map(testRow) : null}
          <Button key="toggle-output" hotkey="o" plain dimColor onPress={() => update($, showOutput, v => !v)}>{`${outputOpen ? '▾' : '▸'} Output`}</Button>
          {outputOpen ? (Code && isApp ? <Code source={run.output || '(no output)'} wrap="wrap" /> : <Text mono wrap="wrap">{run.output || '(no output)'}</Text>) : null}
        </Box>

        {sessionFlaky.length ? (
          <Box flexDirection="column">
            <Text size="caption" color="warning">{`Flaky this session (${sessionFlaky.length}): passed and failed with no edits in between`}</Text>
            {sessionFlaky.slice(0, 8).map(n => <Text size="caption" dimColor wrap="truncate-end">{`  ${n}`}</Text>)}
          </Box>
        ) : null}

        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text size="caption" dimColor>{`Runs (${list.length})`}</Text>
            <Button key="clear" plain dimColor onPress={() => Promise.all([update($, runs, () => []), update($, history, () => ({})), update($, selected, () => null), update($, note, () => null)])}>Clear</Button>
          </Box>
          {[...list].reverse().slice(0, 8).map(runRow)}
        </Box>
      </Box>
    )
  })
}
