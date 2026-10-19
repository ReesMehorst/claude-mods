import type { ClientModule } from 'claude-code'

// Full-width filter field for the desktop pane (a native Input can't be widened).
// Click to focus, type to filter, Backspace deletes, ctrl+U clears, Escape returns focus.
// The query lives here while typing and is posted to the hooks module as `{ q }`;
// a different `props.q` (cleared, or a tab change) replaces it.
type Props = { q: string }
type State = { q: string; seen: string }

export const edit = (q: string, k: { key: string; ctrl?: true; meta?: true }) =>
  k.key === 'backspace' ? q.slice(0, -1)
    : k.ctrl && k.key === 'u' ? ''
    : k.key.length === 1 && !k.ctrl && !k.meta ? q + k.key
    : q

const FilterField: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const state = surface.state
  if (!state || state.seen !== props.q) surface.setState({ q: props.q, seen: props.q }) // adopt a change from outside
  const q = state && state.seen === props.q ? state.q : props.q
  surface.onKey(k => {
    const next = edit(q, k)
    if (next === q) return
    surface.setState({ q: next, seen: props.q })
    surface.post({ q: next })
  })
  return (
    <Box flexDirection="row" borderStyle="round" borderColor="subtle" paddingX={1}>
      {q ? <Text wrap="truncate-end">{q}</Text> : <Text dimColor>Filter</Text>}
      <Text dimColor>▏</Text>
    </Box>
  )
}
export default FilterField
