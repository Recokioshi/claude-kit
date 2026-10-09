/**
 * The /models pane. Pure drawing: takes the surface's element table, the
 * state and the actions; returns the tree. Same tree on every surface (no
 * Select or Input, so the phone gets it too).
 *
 * Two views: the versions (the newest of each family and every version with
 * a rule of its own, the rest behind "more"), and the defaults new versions
 * get, per family.
 */
import type { ElementTable, RenderChildren } from 'claude-code'

import { entriesOf, familiesOf, splitForView } from './catalog'
import type { Catalog, CatalogEntry } from './catalog'
import { decisionFor, fallbackEntry, isRuled } from './policy'
import { ageOf, blockedOf, familyDefaultOf, familyRowsOf, labelOf, statOf } from './state'
import type { GuardState } from './state'

export type Actions = {
  toggleVersion: (key: string) => void
  toggleFamily: (family: string) => void
  toggleExpanded: () => void
  showView: (view: GuardState['view']) => void
  cycleFallback: () => void
  cycleMode: () => void
  refresh: () => void
  toggleRepo: () => void
  close: () => void
}

const pad = (text: string, width: number) => (text.length >= width ? text : text + ' '.repeat(width - text.length))

function statText(state: GuardState, key: string): string {
  const s = statOf(state, key)
  if (s.denied > 0) return `${s.denied} refused`
  if (s.swapped > 0) return `${s.swapped} swapped`
  if (s.uses > 0) return `${s.uses} ${s.uses === 1 ? 'use' : 'uses'}`
  return ''
}

const isOn = (state: GuardState, entry: CatalogEntry) => decisionFor(state.policy, entry.key, entry.family) === 'allow'

/** Where the list came from, and when; or why the last refresh failed. */
export function listStatusOf(catalog: Catalog, now: number): { text: string; isProblem: boolean } {
  if (catalog.lastError !== null) {
    return { text: `list not refreshed: ${catalog.lastError}`, isProblem: true }
  }
  if (catalog.fetchedAt === null) {
    return { text: 'list: models seen in use', isProblem: false }
  }
  const age = ageOf(now - catalog.fetchedAt)
  return { text: `list: Anthropic, updated ${age === 'now' ? 'just now' : `${age} ago`}`, isProblem: false }
}

export function drawModels(t: ElementTable, state: GuardState, actions: Actions, now: number, columns: number) {
  const { Box, Text, Button } = t
  const listName = state.source === 'repo' ? `${state.repoName ?? 'this repo'} list` : 'global'
  const status = listStatusOf(state.catalog, now)
  const dot = (on: boolean) => <Text color={on ? 'success' : undefined} dimColor={!on} bold={on}>{on ? '●' : '○'} </Text>

  const head = (
    <Box key="head" flexDirection="row">
      <Text bold>MODELS</Text>
      <Text dimColor> · {listName}{state.view === 'families' ? ' · new versions' : ''}</Text>
    </Box>
  )

  if (state.view === 'families') {
    const rows = familyRowsOf(state.catalog).map((family, i) => {
      const on = familyDefaultOf(state.policy, family) === 'allow'
      return (
        <Box key={`family-row-${family}`} flexDirection="row">
          {dot(on)}
          <Button key={`family-${family}`} plain hotkey={i < 9 ? String(i + 1) : undefined} label={pad(family === 'other' ? 'other families' : family, 15)} dimColor={!on} onPress={() => actions.toggleFamily(family)} />
          <Text dimColor> {on ? 'allowed' : 'blocked'}</Text>
        </Box>
      )
    })
    return (
      <Box flexDirection="column" paddingX={1}>
        {head}
        <Text key="families-about" dimColor wrap="wrap">For versions without a rule of their own, new releases included.</Text>
        {rows}
        <Box key="footer" flexDirection="row" columnGap={3}>
          <Button key="back" plain hotkey="b" label="Back to versions" onPress={() => actions.showView('versions')} />
          <Button key="close" plain hotkey="x" label="Close" role="dismiss" onPress={actions.close} />
        </Box>
      </Box>
    )
  }

  const showIds = columns >= 44
  const { main, more } = splitForView(state.catalog, entry => isRuled(state.policy, entry.key))
  const fallback = fallbackEntry(state.policy, state.catalog)

  const row = (entry: CatalogEntry, hotkey: string | undefined) => {
    const on = isOn(state, entry)
    return (
      <Box key={`row-${entry.key}`} flexDirection="row">
        {dot(on)}
        <Button key={`toggle-${entry.key}`} plain hotkey={hotkey} label={pad(entry.version || entry.key, 6)} dimColor={!on} onPress={() => actions.toggleVersion(entry.key)} />
        {showIds ? <Text dimColor wrap="truncate-end"> {pad(entry.ids[0] ?? '', 26)}</Text> : null}
        <Box flexGrow={1} />
        <Text dimColor>{statText(state, entry.key)}</Text>
      </Box>
    )
  }

  /** Family headers between the rows; digits for the first nine rows of the main list. */
  const grouped = (entries: CatalogEntry[], withHotkeys: boolean, prefix: string) => {
    const out: RenderChildren[] = []
    let family: string | null = null
    entries.forEach((entry, i) => {
      if (entry.family !== family) {
        family = entry.family
        out.push(
          <Box key={`${prefix}-family-${entry.family}`} flexDirection="row">
            <Text bold>{entry.family.toUpperCase()}</Text>
            {familyDefaultOf(state.policy, entry.family) === 'block' ? <Text dimColor> · new versions: blocked</Text> : null}
          </Box>,
        )
      }
      out.push(row(entry, withHotkeys && i < 9 ? String(i + 1) : undefined))
    })
    return out
  }

  const recent = state.recent.slice(0, 3).map((ev, i) => (
    <Box key={`recent-${i}`} flexDirection="row">
      <Text dimColor>{pad(ageOf(now - ev.at), 4)}</Text>
      <Text color={ev.kind === 'swap' ? 'warning' : 'error'}>{ev.kind === 'swap' ? '~ ' : '✗ '}</Text>
      <Text wrap="truncate-end">
        {ev.kind === 'swap' ? `${ev.what}  ${labelOf(ev.from)} → ${labelOf(ev.to ?? '?')}` : `${ev.what}  ${labelOf(ev.from)} refused`}
      </Text>
    </Box>
  ))

  return (
    <Box flexDirection="column" paddingX={1}>
      {head}
      <Box key="list-status" flexDirection="row">
        <Text color={status.isProblem ? 'warning' : undefined} dimColor={!status.isProblem} wrap="truncate-end">{status.text}</Text>
      </Box>
      {state.catalog.entries.length === 0 ? <Text key="empty" dimColor wrap="wrap">No models known yet: the list fills from Anthropic and from the models sessions run.</Text> : null}
      {grouped(main, true, 'main')}
      {more.length > 0 ? (
        <Button key="more" plain hotkey="o" label={state.expanded ? `▾ hide ${more.length} older versions` : `▸ ${more.length} older versions`} onPress={actions.toggleExpanded} />
      ) : null}
      {state.expanded ? grouped(more, false, 'more') : null}
      <Box key="cycles" flexDirection="row" flexWrap="wrap" columnGap={3}>
        <Button key="new-versions" plain hotkey="n" label="new versions…" onPress={() => actions.showView('families')} />
        <Button key="fallback" plain hotkey="f" label={`fallback: ${fallback === null ? 'none' : labelOf(fallback.key)}`} onPress={actions.cycleFallback} />
        <Button key="mode" plain hotkey="m" label={`explicit asks: ${state.policy.mode}`} onPress={actions.cycleMode} />
      </Box>
      {recent.length > 0 ? <Text key="recent-head" dimColor>RECENT</Text> : null}
      {recent}
      <Box key="footer" flexDirection="row" flexWrap="wrap" columnGap={3}>
        <Button key="refresh" plain hotkey="u" label="Refresh list" onPress={actions.refresh} />
        <Button key="repo" plain hotkey="s" label={state.source === 'repo' ? 'Back to the global list' : `Separate list for ${state.repoName ?? 'this repo'}`} onPress={actions.toggleRepo} />
        <Button key="close" plain hotkey="x" label="Close" role="dismiss" onPress={actions.close} />
      </Box>
    </Box>
  )
}

/** The same content as text, for surfaces that draw nothing and for `/models` output. */
export function textOf(state: GuardState): string {
  const fallback = fallbackEntry(state.policy, state.catalog)
  const lines = familiesOf(state.catalog).map(family => {
    const versions = entriesOf(state.catalog, family).map(e => `${e.version || e.key} ${isOn(state, e) ? '✓' : '✗'}`)
    return `${pad(family, 7)} ${versions.join(', ')}`
  })
  const blocked = blockedOf(state.policy)
  return [
    `Model versions in this session (${state.source === 'repo' ? `${state.repoName ?? 'this repo'}'s own list` : 'the global list'}; blocked: ${blocked.join(', ') || 'nothing'}; fallback ${fallback === null ? 'none' : labelOf(fallback.key)}; explicit asks for a blocked one are ${state.policy.mode === 'deny' ? 'refused' : 'swapped'})`,
    ...lines,
    'Change: /models allow|block <model> · /models new <family> allow|block · /models refresh · /models repo|global · /models help',
  ].join('\n')
}
