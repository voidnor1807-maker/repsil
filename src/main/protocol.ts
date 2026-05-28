import { net, protocol } from 'electron'
import { isAbsolute, relative } from 'node:path'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { getDb } from './db'
import { resolveInsideArchive } from './pathSafety'
import { REPSIL_FILE_SCHEME } from '@shared/repsilFile'

/**
 * Custom scheme: repsil-file://archive/<rel-path>
 *
 * Why not file://? Electron locks down file:// from the renderer for good
 * reasons. We register a privileged scheme with a strict allowlist: the
 * resolved absolute path MUST live inside the currently-open archive root,
 * both lexically and after symlink resolution. Anything else returns 403.
 */
export { REPSIL_FILE_SCHEME }

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
    const rel = decodeURIComponent(url.pathname)
    const repsil = getDb()
    if (!repsil) return new Response(null, { status: 404 })

    // Lexical containment check (traversal / absolute / drive-letter / null-byte).
    const abs = resolveInsideArchive(repsil.rootPath, rel)
    if (!abs) return new Response(null, { status: 403 })

    // Never serve our private state directory.
    const lexInside = relative(repsil.rootPath, abs)
    if (lexInside === '.repsil' || lexInside.startsWith('.repsil/') || lexInside.startsWith('.repsil\\')) {
      return new Response(null, { status: 403 })
    }

    // Symlink check: resolve the real path and re-verify it stays inside the
    // real root. A symlink inside the archive pointing outside is rejected.
    let realAbs: string
    let realRoot: string
    try {
      realAbs = realpathSync(abs)
      realRoot = realpathSync(repsil.rootPath)
    } catch {
      return new Response(null, { status: 404 })
    }
    const realInside = relative(realRoot, realAbs)
    if (realInside.startsWith('..') || isAbsolute(realInside)) {
      return new Response(null, { status: 403 })
    }

    return net.fetch(pathToFileURL(realAbs).toString())
  })
}
