import type { Framework, Result, Run, Status, TestResult } from '../types'

// Runner tokens in the order they are tried; the first that matches names the framework.
const RUNNERS: [Framework, RegExp][] = [
  ['pytest', /(?:^|[\s;&|(])(?:python3?\s+-m\s+)?pytest\b/],
  ['vitest', /\bvitest\b/],
  ['jest', /\bjest\b/],
  ['go', /\bgo\s+test\b/],
  ['cargo', /\bcargo\s+(?:test|nextest\s+run)\b/],
  ['node', /\bnode\s+(?:[^|;&]*\s)?--test\b/],
  ['mocha', /\bmocha\b/],
  ['bun', /\bbun\s+test\b/],
  ['deno', /\bdeno\s+test\b/],
  ['script', /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::\S+)?\b|\bnpx\s+playwright\s+test\b|\bmake\s+(?:\S+\s+)?test\b|\bclaude\s+plugin\s+test\b|\brspec\b|\bphpunit\b|\bdotnet\s+test\b|\bmvn\s+(?:\S+\s+)?test\b|\bgradlew?\s+(?:\S+\s+)?test\b|\bctest\b|\bunittest\b|\btox\b/],
]

/** The framework a Bash command runs tests with, or null when it runs none. */
export function detect(command: string): Framework | null {
  const c = command.replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""') // ignore words inside quotes ("echo 'pytest'")
  if (/^\s*(?:echo|cat|grep|rg|ls|which|man|git)\b/.test(c)) return null
  for (const [f, re] of RUNNERS) if (re.test(c)) return f
  return null
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g
const DURATION = /\s+[([]?\d+(?:\.\d+)?\s*m?s[)\]]?\s*$/ // " (5 ms)", " 12ms", " [3.39ms]"

/** Per-test outcomes read from a run's output; failures win when one name shows twice. */
export function parse(output: string): TestResult[] {
  const found = new Map<string, Status>()
  const put = (name: string, status: Status) => {
    const n = name.trim()
    if (!n || n.length > 300) return
    const was = found.get(n)
    if (was === 'fail' || (was === 'pass' && status === 'skip')) return
    found.set(n, status)
  }
  for (const raw of output.replace(ANSI, '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '')
    let m: RegExpMatchArray | null
    // pytest -v: "tests/a.py::test_x PASSED [ 50%]"; summary: "FAILED tests/a.py::test_x - assert ..."
    if ((m = line.match(/^(\S+::\S+)\s+(PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)\b/))) put(m[1]!, m[2]! === 'PASSED' || m[2]! === 'XPASS' ? 'pass' : m[2]! === 'SKIPPED' || m[2]! === 'XFAIL' ? 'skip' : 'fail')
    else if ((m = line.match(/^(FAILED|ERROR)\s+(\S+::\S+)/))) put(m[2]!, 'fail')
    // go: "--- PASS: TestX (0.00s)"
    else if ((m = line.match(/^\s*--- (PASS|FAIL|SKIP): (\S+)/))) put(m[2]!, m[1]! === 'PASS' ? 'pass' : m[1]! === 'FAIL' ? 'fail' : 'skip')
    // cargo / libtest: "test mod::name ... ok"
    else if ((m = line.match(/^test (\S+) \.\.\. (ok|FAILED|ignored)/))) put(m[1]!, m[2]! === 'ok' ? 'pass' : m[2]! === 'FAILED' ? 'fail' : 'skip')
    // TAP (node --test, tap, bun): "ok 1 - name", "not ok 2 - name # SKIP"
    else if ((m = line.match(/^\s*(not ok|ok) \d+(?: -)? (.+?)(?:\s+#\s*(SKIP|TODO)\b.*)?$/i))) put(m[2]!, m[3]! ? 'skip' : m[1]! === 'ok' ? 'pass' : 'fail')
    // vitest failure header: " FAIL  src/a.test.ts > suite > name"
    else if ((m = line.match(/^\s*FAIL\s+\S+\s+>\s+(.+)$/))) put(m[1]!.replace(DURATION, ''), 'fail')
    // jest / vitest / mocha / bun / node spec reporter marks
    else if ((m = line.match(/^\s*(?:✓|✔|√|\(pass\))\s+(.+)$/))) put(m[1]!.replace(DURATION, ''), 'pass')
    else if ((m = line.match(/^\s*(?:✕|✗|×|✘|✖|\(fail\))\s+(.+)$/))) put(m[1]!.replace(DURATION, ''), 'fail')
    else if ((m = line.match(/^\s*(?:○|↓)\s+(?:skipped\s+)?(.+)$/))) put(m[1]!.replace(/\s+\[skipped\]$/, '').replace(DURATION, ''), 'skip')
    // jest failure block: "  ● Suite › name"
    else if ((m = line.match(/^\s*● (.+ › .+)$/))) put(m[1]!.split(' › ').slice(1).join(' '), 'fail')
  }
  return [...found].map(([name, status]) => ({ name, status }))
}

/** Totals from a summary line, for runners whose output names no single test. */
export function summary(output: string): { passed: number; failed: number; skipped: number } | null {
  const text = output.replace(ANSI, '')
  const num = (re: RegExp) => { let n = -1; for (const m of text.matchAll(re)) n = Number(m[1]); return n }
  const passed = num(/(\d+) (?:passed|passing|pass(?:es)?\b)/gi)
  const failed = num(/(\d+) (?:failed|failing|fail(?:ures?)?\b)/gi)
  const skipped = num(/(\d+) (?:skipped|pending|ignored|todo)\b/gi)
  if (passed < 0 && failed < 0) return null
  return { passed: Math.max(0, passed), failed: Math.max(0, failed), skipped: Math.max(0, skipped) }
}

/** Exit code from the Bash result text ("Exit code 1" heads an errored call); 0 when it answered cleanly. */
export function exitCode(text: string, isError: boolean): number | null {
  const m = text.match(/^Exit code (\d+)/m)
  if (m) return Number(m[1])
  return isError ? null : 0
}

/** Last lines of the output, for the pane's output box. */
export function tail(output: string, lines = 40): string {
  return output.replace(ANSI, '').trimEnd().split(/\r?\n/).slice(-lines).join('\n')
}

/** The history key of a test: the same name under another runner is another test. */
export const testKey = (f: Framework, name: string) => `${f}:${name}`

/** Flaky: it both passed and failed while no file changed in between (same edit count). */
export function isFlaky(history: readonly Result[] | undefined): boolean {
  if (!history) return false
  const seen = new Map<number, Set<Status>>()
  for (const r of history) {
    if (r.status === 'skip') continue
    const s = seen.get(r.editSeq) ?? new Set()
    s.add(r.status)
    seen.set(r.editSeq, s)
    if (s.size === 2) return true
  }
  return false
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
const re = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const alt = (names: string[]) => names.map(re).join('|')

/**
 * A command that reruns only the failed tests, built from the run's own command,
 * or null when the runner has no filter we know.
 */
export function rerunCommand(run: Pick<Run, 'command' | 'framework'>, failed: string[]): string | null {
  if (!failed.length) return null
  const cmd = run.command.trim()
  const viaScript = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/.test(cmd) && !/\bbun\s+test\b/.test(cmd)
  const cut = (token: RegExp) => { const m = cmd.match(token); return m ? cmd.slice(0, m.index! + m[0].length) : null }
  switch (run.framework) {
    case 'pytest': {
      const head = cut(/(?:python3?\s+-m\s+)?pytest\b/)
      return head && `${head} -v ${failed.map(q).join(' ')}`
    }
    case 'jest':
    case 'vitest': {
      const pattern = q(alt(failed.map(n => n.split(' > ').pop()!)))
      if (viaScript) return `${cmd.split(/\s+--\s+/)[0]} -- -t ${pattern}`
      const head = run.framework === 'vitest' ? cut(/\bvitest(?:\s+run)?\b/) : cut(/\bjest\b/)
      return head && `${head}${run.framework === 'vitest' && !/\brun$/.test(head) ? ' run' : ''} -t ${pattern}`
    }
    case 'go': {
      const tops = [...new Set(failed.map(n => n.split('/')[0]!))]
      return `${cmd.replace(/\s+-run(?:=|\s+)\S+/, '')} -run ${q(`^(${alt(tops)})$`)}`
    }
    case 'cargo':
      return `${cmd.split(/\s+--\s+/)[0]} -- --exact ${failed.map(q).join(' ')}`
    case 'node': {
      const head = cut(/\bnode\s+(?:[^|;&]*\s)?--test\b/)
      return head && `${head} --test-name-pattern=${q(alt(failed))}${cmd.slice(head.length)}`
    }
    case 'mocha':
      return `${cmd.replace(/\s+--grep(?:=|\s+)\S+/, '')} --grep ${q(alt(failed))}`
    case 'bun':
      return `${cmd.replace(/\s+(?:-t|--test-name-pattern)(?:=|\s+)\S+/, '')} -t ${q(alt(failed))}`
    case 'deno':
      return `${cmd.replace(/\s+--filter(?:=|\s+)\S+/, '')} --filter ${q(`/^(${alt(failed)})$/`)}`
    default:
      return null
  }
}

/** Short age text: "now", "4m", "2h". */
export function age(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  return s < 45 ? 'now' : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`
}

/** "12 passed · 2 failed · 1 skipped", or the exit when nothing was counted. */
export function countLine(r: Pick<Run, 'passed' | 'failed' | 'skipped' | 'exitCode'>): string {
  const parts = [r.passed && `${r.passed} passed`, r.failed && `${r.failed} failed`, r.skipped && `${r.skipped} skipped`].filter(Boolean)
  if (parts.length) return parts.join(' · ')
  return r.exitCode === 0 ? 'passed (no per-test output)' : r.exitCode === null ? 'interrupted' : `exit ${r.exitCode}`
}

/** The prompt draft for "Fix with Claude": failing names, flaky ones apart, and the output tail. */
export function fixPrompt(run: Run, failed: string[], flaky: string[]): string {
  const real = failed.filter(n => !flaky.includes(n))
  return [
    `These tests fail when I run \`${run.command}\`:`,
    ...real.map(n => `- ${n}`),
    flaky.length ? `\nThese also failed but have passed with no change in between, so they look flaky; check for order, timing or shared state:\n${flaky.map(n => `- ${n}`).join('\n')}` : '',
    `\nLast output:\n\`\`\`\n${run.output}\n\`\`\``,
    '\nFind the cause and fix it, then rerun the tests.',
  ].filter(Boolean).join('\n')
}
