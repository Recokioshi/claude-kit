/**
 * The /models pane. Pure drawing: takes the surface's element table, the
 * state and the actions; returns the tree. Same tree on every surface (no
 * Select or Input, so the phone gets it too).
 */
import type { ElementTable } from 'claude-code'

import { ageOf, FAMILIES, fallbackOf, idFor } from './families'
import type { Family, GuardState } from './families'

export type Actions = {
  toggle: (family: Family) => void
  cycleFallback: () => void
  cycleMode: () => void
  save: () => void
  reset: () => void
  saveDefault: () => void
  close: () => void
}

const pad = (text: string, width: number) => (text.length >= width ? text : text + ' '.repeat(width - text.length))

function statOf(state: GuardState, family: Family): string {
  const s = state.stats[family]
  if (s.denied > 0) return `${s.denied} refused`
  if (s.swapped > 0) return `${s.swapped} swapped`
  if (s.uses > 0) return `${s.uses} ${s.uses === 1 ? 'use' : 'uses'}`
  return ''
}

export function drawModels(t: ElementTable, state: GuardState, actions: Actions, now: number, columns: number) {
  const { Box, Text, Button } = t
  const showIds = columns >= 44
  const fallback = fallbackOf(state)
  const repoLabel = state.repoName ?? 'this repo'

  const rows = FAMILIES.map((family, i) => {
    const on = state.allowed.includes(family)
    const id = family === 'other' ? '' : (idFor(family, state.seen) ?? '')
    return (
      <Box key={`row-${family}`} flexDirection="row">
        <Text color={on ? 'success' : undefined} dimColor={!on} bold={on}>{on ? '●' : '○'} </Text>
        <Button key={`toggle-${family}`} plain hotkey={String(i + 1)} label={pad(family, 7)} dimColor={!on} onPress={() => actions.toggle(family)} />
        {showIds ? <Text dimColor wrap="truncate-end"> {pad(id, 26)}</Text> : null}
        <Box flexGrow={1} />
        <Text dimColor>{statOf(state, family)}</Text>
      </Box>
    )
  })

  const recent = state.recent.slice(0, 3).map((ev, i) => (
    <Box key={`recent-${i}`} flexDirection="row">
      <Text dimColor>{pad(ageOf(now - ev.at), 4)}</Text>
      <Text color={ev.kind === 'swap' ? 'warning' : 'error'}>{ev.kind === 'swap' ? '~ ' : '✗ '}</Text>
      <Text wrap="truncate-end">
        {ev.kind === 'swap' ? `${ev.what}  ${ev.from} → ${ev.to ?? '?'}` : `${ev.what}  ${ev.from} refused`}
      </Text>
    </Box>
  ))

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box key="head" flexDirection="row">
        <Text bold>MODELS</Text>
        <Text dimColor> · {state.source === 'session' ? 'changed this session' : state.source === 'repo' ? `${repoLabel} default` : 'global default'}</Text>
      </Box>
      {rows}
      <Box key="cycles" flexDirection="row" gap={3}>
        <Button key="fallback" plain hotkey="f" label={`fallback: ${fallback ?? 'none'}`} onPress={actions.cycleFallback} />
        <Button key="mode" plain hotkey="m" label={`explicit asks: ${state.mode}`} onPress={actions.cycleMode} />
      </Box>
      {recent.length > 0 ? <Text key="recent-head" dimColor>RECENT</Text> : null}
      {recent}
      {/* Its own row, wrapping: a long repo name must not push the global save out of a narrow pane. */}
      <Box key="saves" flexDirection="row" flexWrap="wrap" columnGap={3}>
        <Button key="save" plain hotkey="s" label={`Save for ${repoLabel}`} onPress={actions.save} />
        <Button key="default" plain hotkey="g" label="Save as global default" onPress={actions.saveDefault} />
      </Box>
      <Box key="footer" flexDirection="row" gap={3}>
        <Button key="reset" plain hotkey="r" label="Reset" onPress={actions.reset} />
        <Button key="close" plain hotkey="x" label="Close" role="dismiss" onPress={actions.close} />
      </Box>
    </Box>
  )
}

/** The same content as text, for surfaces that draw nothing and for `/models` output. */
export function textOf(state: GuardState): string {
  const fallback = fallbackOf(state)
  const lines = FAMILIES.map(f => `${state.allowed.includes(f) ? '●' : '○'} ${pad(f, 7)} ${state.stats[f].uses} uses · ${state.stats[f].swapped} swapped · ${state.stats[f].denied} refused`)
  return [
    `Models allowed in this session: ${state.allowed.join(', ')} (fallback ${fallback ?? 'none'}, explicit disallowed asks are ${state.mode === 'deny' ? 'refused' : 'swapped'})`,
    ...lines,
    'Change: /models opus,sonnet · /models save (this repo) · /models default (global default) · /models reset',
  ].join('\n')
}
