import { net, protocol } from 'electron'
import { isAbsolute, join, normalize, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getDb } from './db'

/**
 * Custom scheme: repsil-file://archive/<rel-path>
 *
 * Why not file://? Electron locks down file:// from the renderer for good
 * reasons. We register a privileged scheme with a strict allowlist: the
 * resolved absolute path MUST live inside the currently-open archive root.
 * Anything else returns 403.
 */
export const REPSIL_FILE_SCHEME = 'repsil-file'

/** Must be called before app.whenReady(). */
export function registerProtocolSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: REPSIL_FILE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false
      }
    }
  ])
}

/** Must be called after app.whenReady(). */
export function registerProtocolHandlers(): void {
  protocol.handle(REPSIL_FILE_SCHEME, (request) => {
    const url = new URL(request.url)
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const repsil = getDb()
    if (!repsil) return new Response(null, { status: 404 })

    const abs = normalize(join(repsil.rootPath, rel))
    const inside = relative(repsil.rootPath, abs)
    // Reject anything that escapes the root or is absolute outside it
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) {
      return new Response(null, { status: 403 })
    }
    // Also block .repsil/ — that's our private state
    if (inside === '.repsil' || inside.startsWith('.repsil/') || inside.startsWith('.repsil\\')) {
      return new Response(null, { status: 403 })
    }
    return net.fetch(pathToFileURL(abs).toString())
  })
}

/** Renderer-side URL builder. */
export function makeRepsilFileUrl(relPath: string): string {
  // archive/ is a fixed host so URL parsing is predictable
  return `${REPSIL_FILE_SCHEME}://archive/${encodeURI(relPath)}`
}
