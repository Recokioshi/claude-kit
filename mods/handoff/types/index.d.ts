/** Mirrors hooks/note.ts Entry and hooks/view.tsx Preview. */
export type HandoffEntry = {
  id: string
  path: string
  repo: string
  to: string
  title: string
  branch: string | null
  createdAt: number
  consumedAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    handoff: {
      pane: { items: HandoffEntry[]; selected: number; previews: Record<string, { tldr: string; next: string[] }>; repo: string }
    }
  }
}
