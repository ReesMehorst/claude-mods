export type Framework = 'pytest' | 'jest' | 'vitest' | 'go' | 'cargo' | 'node' | 'mocha' | 'bun' | 'deno' | 'script'
export type Status = 'pass' | 'fail' | 'skip'
export type TestResult = { name: string; status: Status }
// One test run: a Bash call Claude made, or a rerun from the pane.
export type Run = {
  id: number
  command: string
  framework: Framework
  at: number
  durationMs: number
  exitCode: number | null // null: interrupted or no exit reported
  tests: TestResult[]
  passed: number
  failed: number
  skipped: number
  output: string // last lines
  byPane: boolean
}
// One outcome of a test in its history; editSeq counts file edits before the run.
export type Result = { run: number; status: Status; editSeq: number }

declare module 'claude-code' {
  interface PluginState {
    'test-pane': {
      runs: Shaped<Run[]>
      history: Shaped<Record<string, Result[]>>
      editSeq: number
      selected: number | null
      showPassed: boolean
      showOutput: boolean
      busy: string | null
      note: string | null
      dismissed: boolean
    }
  }
}
