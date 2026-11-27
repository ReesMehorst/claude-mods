import { test, expect } from 'claude-code/testing'
import { age, countLine, detect, exitCode, isFlaky, parse, rerunCommand, summary } from './parse'

test('detect: test commands by runner, not other commands', () => {
  expect(detect('pytest -q tests/')).toBe('pytest')
  expect(detect('cd api && python -m pytest -x')).toBe('pytest')
  expect(detect('npx vitest run')).toBe('vitest')
  expect(detect('npx jest --ci')).toBe('jest')
  expect(detect('go test ./...')).toBe('go')
  expect(detect('cargo test --lib')).toBe('cargo')
  expect(detect('node --test test/')).toBe('node')
  expect(detect('bun test')).toBe('bun')
  expect(detect('npm test')).toBe('script')
  expect(detect('pnpm run test:unit')).toBe('script')
  expect(detect('claude plugin test ./usage-band')).toBe('script')
  expect(detect('npm install')).toBeNull()
  expect(detect('grep -r pytest .')).toBeNull()
  expect(detect("echo 'run pytest later'")).toBeNull()
  expect(detect('git log --grep test')).toBeNull()
})

test('parse pytest -v and its summary', () => {
  const out = [
    'tests/test_a.py::test_ok PASSED      [ 33%]',
    'tests/test_a.py::test_bad FAILED     [ 66%]',
    'tests/test_a.py::test_skip SKIPPED (no db) [100%]',
    '=========== short test summary info ===========',
    'FAILED tests/test_a.py::test_bad - assert 1 == 2',
  ].join('\n')
  expect(parse(out)).toEqual([
    { name: 'tests/test_a.py::test_ok', status: 'pass' },
    { name: 'tests/test_a.py::test_bad', status: 'fail' },
    { name: 'tests/test_a.py::test_skip', status: 'skip' },
  ])
})

test('parse jest / vitest marks, ANSI and durations stripped', () => {
  const out = '\x1b[32m  ✓ adds numbers (3 ms)\x1b[0m\n  ✕ divides by zero (12 ms)\n  ○ skipped later\n  ● math › divides by zero\n'
  expect(parse(out)).toEqual([
    { name: 'adds numbers', status: 'pass' },
    { name: 'divides by zero', status: 'fail' },
    { name: 'later', status: 'skip' },
  ])
})

test('parse go, cargo and TAP', () => {
  expect(parse('--- PASS: TestA (0.00s)\n--- FAIL: TestB (0.01s)\n    --- FAIL: TestB/sub (0.00s)')).toEqual([
    { name: 'TestA', status: 'pass' },
    { name: 'TestB', status: 'fail' },
    { name: 'TestB/sub', status: 'fail' },
  ])
  expect(parse('test util::parses ... ok\ntest util::breaks ... FAILED\ntest slow ... ignored')).toEqual([
    { name: 'util::parses', status: 'pass' },
    { name: 'util::breaks', status: 'fail' },
    { name: 'slow', status: 'skip' },
  ])
  expect(parse('ok 1 - first\nnot ok 2 - second\nok 3 - third # SKIP no env')).toEqual([
    { name: 'first', status: 'pass' },
    { name: 'second', status: 'fail' },
    { name: 'third', status: 'skip' },
  ])
})

test('parse bun-style (pass)/(fail) with bracketed times', () => {
  expect(parse('(pass) adds [3.39ms]\n(fail) breaks [0.6ms]')).toEqual([
    { name: 'adds', status: 'pass' },
    { name: 'breaks', status: 'fail' },
  ])
})

test('summary counts when no test is named', () => {
  expect(summary('Tests: 2 failed, 40 passed, 42 total')).toEqual({ passed: 40, failed: 2, skipped: 0 })
  expect(summary('=== 3 passed, 1 skipped in 0.2s ===')).toEqual({ passed: 3, failed: 0, skipped: 1 })
  expect(summary('Build OK')).toBeNull()
})

test('exit code from the Bash result text', () => {
  expect(exitCode('Exit code 1\nFAILED', true)).toBe(1)
  expect(exitCode('all good', false)).toBe(0)
  expect(exitCode('Interrupted', true)).toBeNull()
})

test('flaky only when both outcomes share an edit count', () => {
  expect(isFlaky([{ run: 1, status: 'fail', editSeq: 0 }, { run: 2, status: 'pass', editSeq: 1 }])).toBe(false) // fixed by an edit
  expect(isFlaky([{ run: 1, status: 'fail', editSeq: 2 }, { run: 2, status: 'pass', editSeq: 2 }])).toBe(true)
  expect(isFlaky([{ run: 1, status: 'skip', editSeq: 2 }, { run: 2, status: 'pass', editSeq: 2 }])).toBe(false)
  expect(isFlaky(undefined)).toBe(false)
})

test('rerun only the failed tests, per runner', () => {
  expect(rerunCommand({ command: 'cd api && uv run pytest -q tests/', framework: 'pytest' }, ['tests/a.py::t1', "tests/a.py::t[it's]"]))
    .toBe(`cd api && uv run pytest -v 'tests/a.py::t1' 'tests/a.py::t[it'\\''s]'`)
  expect(rerunCommand({ command: 'npx jest --ci', framework: 'jest' }, ['adds (a+b)'])).toBe(`npx jest -t 'adds \\(a\\+b\\)'`)
  expect(rerunCommand({ command: 'npm test -- --watch=false', framework: 'jest' }, ['a', 'b'])).toBe(`npm test -- -t 'a|b'`)
  expect(rerunCommand({ command: 'npx vitest', framework: 'vitest' }, ['src/x.test.ts > suite > works'])).toBe(`npx vitest run -t 'works'`)
  expect(rerunCommand({ command: 'go test ./... -run Old', framework: 'go' }, ['TestB', 'TestB/sub'])).toBe(`go test ./... -run '^(TestB)$'`)
  expect(rerunCommand({ command: 'cargo test --lib', framework: 'cargo' }, ['util::breaks'])).toBe(`cargo test --lib -- --exact 'util::breaks'`)
  expect(rerunCommand({ command: 'node --test test/', framework: 'node' }, ['second'])).toBe(`node --test --test-name-pattern='second' test/`)
  expect(rerunCommand({ command: 'make test', framework: 'script' }, ['x'])).toBeNull()
  expect(rerunCommand({ command: 'pytest', framework: 'pytest' }, [])).toBeNull()
})

test('age and count line', () => {
  expect(age(0, 10_000)).toBe('now')
  expect(age(0, 600_000)).toBe('10m')
  expect(countLine({ passed: 3, failed: 1, skipped: 0, exitCode: 1 })).toBe('3 passed · 1 failed')
  expect(countLine({ passed: 0, failed: 0, skipped: 0, exitCode: 2 })).toBe('exit 2')
})
