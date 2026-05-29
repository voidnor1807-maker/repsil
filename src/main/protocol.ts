import { net, protocol } from 'electron'
import { extname, isAbsolute, relative } from 'node:path'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { getDb } from './db'
import { resolveInsideArchive } from './pathSafety'
import { REPSIL_FILE_SCHEME } from '@shared/repsilFile'

/**
 * net.fetch() on a file:// URL does not set a reliable Content-Type. Chromium
 * then guesses, and for PDFs that means a download instead of inline rendering.
 * We override the header from the extension for the types we preview.
 */
const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  md: 'text/plain; charset=utf-8',
  markdown: 'text/plain; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  text: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  csv: 'text/plain; charset=utf-8',
  tsv: 'text/plain; charset=utf-8',
  json: 'text/plain; charset=utf-8',
  xml: 'text/plain; charset=utf-8',
  yml: 'text/plain; charset=utf-8',
  yaml: 'text/plain; charset=utf-8',
  ini: 'text/plain; charset=utf-8'
}

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
  protocol.handle(REPSIL_FILE_SCHEME, async (request) => {
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

    const res = await net.fetch(pathToFileURL(realAbs).toString())
    const mime = MIME_BY_EXT[extname(realAbs).slice(1).toLowerCase()]
    if (!mime) return res
    const headers = new Headers(res.headers)
    headers.set('content-type', mime)
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  })
}
