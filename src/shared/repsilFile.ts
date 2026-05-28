/** Custom privileged scheme used to serve archive files to the renderer. */
export const REPSIL_FILE_SCHEME = 'repsil-file'

/**
 * Build a repsil-file:// URL for an archive-relative path. Single source of
 * truth shared by the renderer and main process (IN-02). `archive` is a fixed
 * host so URL parsing in the protocol handler is predictable.
 */
export function makeRepsilFileUrl(relPath: string): string {
  return `${REPSIL_FILE_SCHEME}://archive/${encodeURI(relPath)}`
}
