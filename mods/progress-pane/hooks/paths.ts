/**
 * Paths in both styles, so the mod works on native Windows too. A path is
 * Windows-style when it starts with a drive letter (`C:\` or `C:/`) or `\\`.
 * Anything else is left exactly as it is: on macOS and Linux a backslash is
 * an ordinary file-name character. Pure.
 */

const DRIVE = /^[A-Za-z]:[\\/]/

/** `C:\repo`, `c:/repo` or `\\server\share`. */
export const isWindowsPath = (path: string): boolean => DRIVE.test(path) || path.startsWith('\\\\')

/** A path that does not depend on the working folder: `/x`, `\x`, `C:\x`, `C:/x`. */
export const isAbsolutePath = (path: string): boolean => path.startsWith('/') || path.startsWith('\\') || DRIVE.test(path)

/** A Windows path with `/` separators and an upper-case drive letter, so one file has one spelling. Other paths are unchanged. */
export const normalizePath = (path: string): string => (isWindowsPath(path) ? path.replace(/\\/g, '/').replace(/^[a-z]:/, drive => drive.toUpperCase()) : path)

/** What two spellings of a Windows path share: `/` separators, no case (NTFS ignores it). */
const keyOf = (path: string, isWindows: boolean): string => (isWindows ? path.replace(/\\/g, '/').toLowerCase() : path)

/** Whether two paths name the same file, whatever their separators or (on Windows) their case. */
export function samePath(a: string, b: string): boolean {
  const isWindows = isWindowsPath(a) || isWindowsPath(b)
  return keyOf(a, isWindows) === keyOf(b, isWindows)
}

/** `root` + `rel`, joined with `/` (no doubled separator); a Windows result is normalized. */
export const joinPath = (root: string, rel: string): string => normalizePath(`${root.replace(/[\\/]+$/, '')}/${rel}`)

/** `path` below `root` as a short relative path (`plans/a-worklog.md`); the path itself when it is elsewhere. */
export function relativeTo(root: string, path: string): string {
  const isWindows = isWindowsPath(root) || isWindowsPath(path)
  const rootKey = keyOf(root, isWindows)
  const prefix = rootKey.endsWith('/') ? rootKey : `${rootKey}/`
  if (!keyOf(path, isWindows).startsWith(prefix)) return normalizePath(path)
  return (isWindows ? path.replace(/\\/g, '/') : path).slice(prefix.length)
}

/** The last segment of a path in either style: `C:\repo\src\tiers.ts` → `tiers.ts`. */
export const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? ''
