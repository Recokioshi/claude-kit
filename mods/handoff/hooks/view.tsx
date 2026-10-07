/**
 * The handoff pane: the newest notes on top, the selected one's TL;DR and
 * next steps below, actions in one row. Buttons only (the phone draws it too).
 */
import type { ElementTable } from 'claude-code'

import { whenOf } from './note'
import type { Entry } from './note'

export type Preview = { tldr: string; next: string[] }

export type HandoffActions = {
  select: (index: number) => void
  insert: () => void
  insertFull: () => void
  copy: () => void
  close: () => void
}

const fit = (text: string, width: number) => (text.length <= width ? text.padEnd(width) : `${text.slice(0, Math.max(0, width - 1))}…`)

export function drawHandoffs(t: ElementTable, items: Entry[], selected: number, preview: Preview | null, repo: string, now: number, columns: number, actions: HandoffActions) {
  const { Box, Text, Button } = t
  const width = Math.max(30, columns - 2)
  const waiting = items.filter(i => i.consumedAt === undefined && i.to.toLowerCase().includes(repo.toLowerCase())).length
  const shown = items.slice(0, 3)
  const current = items[selected]

  if (items.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold>HANDOFFS</Text>
        <Text dimColor>No handoffs yet. /handoff writes one for the next session.</Text>
        <Button key="close" plain hotkey="x" label="Close" role="dismiss" onPress={actions.close} />
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box key="head" flexDirection="row">
        <Text bold>HANDOFFS</Text>
        <Text dimColor> · newest first</Text>
        <Box flexGrow={1} />
        {waiting > 0 ? <Text color="warning">{waiting} for {repo}</Text> : null}
      </Box>
      {shown.map((item, i) => {
        const isSelected = i === selected
        const isForHere = item.to.toLowerCase().includes(repo.toLowerCase())
        return (
          <Box key={`row-${i}`} flexDirection="row">
            <Button key={`pick-${i}`} plain hotkey={String(i + 1)} label={isSelected ? '▶' : ' '} onPress={() => actions.select(i)} />
            <Text dimColor> {whenOf(item.createdAt, now).padEnd(6)}</Text>
            <Text dimColor={item.consumedAt !== undefined}>{fit(`${item.repo} → ${item.to}`, Math.min(24, Math.floor(width / 3)))} </Text>
            <Text bold={isForHere && item.consumedAt === undefined} dimColor={item.consumedAt !== undefined} wrap="truncate-end">{item.title}</Text>
          </Box>
        )
      })}
      {items.length > 3 ? <Text key="more" dimColor>   +{items.length - 3} older</Text> : null}
      {current ? (
        <Box key="sel" flexDirection="row">
          <Text dimColor wrap="truncate-end">── {selected + 1} · {current.branch ?? current.repo} {'─'.repeat(Math.max(2, width - 12 - (current.branch ?? current.repo).length))}</Text>
        </Box>
      ) : null}
      {preview ? (
        <Box key="tldr" flexDirection="row">
          <Text dimColor>TL;DR  </Text>
          <Text wrap="wrap">{preview.tldr || '–'}</Text>
        </Box>
      ) : null}
      {preview && preview.next.length > 0 ? (
        <Box key="next" flexDirection="row">
          <Text dimColor>Next   </Text>
          <Text wrap="truncate-end">{preview.next.map((n, i) => `${i + 1} ${n}`).join(' · ')}</Text>
        </Box>
      ) : null}
      <Box key="actions" flexDirection="row" gap={2}>
        <Button key="insert" plain hotkey="i" label="Insert" variant="primary" onPress={actions.insert} />
        <Button key="insert-full" plain hotkey="f" label="Insert full" onPress={actions.insertFull} />
        <Button key="copy" plain hotkey="c" label="Copy" onPress={actions.copy} />
        <Button key="close" plain hotkey="x" label="Close" role="dismiss" onPress={actions.close} />
      </Box>
    </Box>
  )
}
