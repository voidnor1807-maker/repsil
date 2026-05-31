import * as React from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { useTranslation } from 'react-i18next'
import {
  Search,
  FileText,
  Loader2,
  Pencil,
  RefreshCw,
  Scissors,
  Copy as CopyIcon,
  Settings,
  Tag as TagIcon,
  Trash2,
  AlertCircle,
  ExternalLink,
  FolderOpen,
  Wifi
} from 'lucide-react'
import { WorkShell } from '@renderer/components/layout/WorkShell'
import { FolderTree } from '@renderer/components/FolderTree'
import { SearchFilters } from '@renderer/components/SearchFilters'
import { cn } from '@renderer/lib/utils'

// Code-split the heavy/rarely-first-rendered views (K3)
const DocumentView = React.lazy(() =>
  import('@renderer/pages/DocumentView').then((m) => ({ default: m.DocumentView }))
)
const SettingsSheet = React.lazy(() =>
  import('@renderer/components/SettingsSheet').then((m) => ({ default: m.SettingsSheet }))
)
const SyncSheet = React.lazy(() =>
  import('@renderer/components/SyncSheet').then((m) => ({ default: m.SyncSheet }))
)
const TrashView = React.lazy(() =>
  import('@renderer/pages/TrashView').then((m) => ({ default: m.TrashView }))
)
import type {
  AppSettings,
  ExtractionQueueStatus,
  FolderNode,
  SearchFilters as Filters,
  SearchResult,
  SyncStatus,
  TagWithUsage
} from '@shared/types'

interface DashboardProps {
  settings: AppSettings
  onSettingsChange: (s: AppSettings) => void
}

const PAGE_SIZE = 100

export function Dashboard({ settings, onSettingsChange }: DashboardProps): JSX.Element {
  const { t } = useTranslation()
  const [query, setQuery] = React.useState('')
  const [filters, setFilters] = React.useState<Filters>({})
  const [selectedFolder, setSelectedFolder] = React.useState<string>('')
  const [results, setResults] = React.useState<SearchResult[]>([])
  const [loading, setLoading] = React.useState(true)
  const [folderTree, setFolderTree] = React.useState<FolderNode | null>(null)
  const [tags, setTags] = React.useState<TagWithUsage[]>([])
  const [queueStatus, setQueueStatus] = React.useState<ExtractionQueueStatus | null>(null)
  const [selectedId, setSelectedId] = React.useState<number | null>(null)
  const [trashOpen, setTrashOpen] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [syncOpen, setSyncOpen] = React.useState(false)
  const [syncStatus, setSyncStatus] = React.useState<SyncStatus | null>(null)
  const [tagsByDoc, setTagsByDoc] = React.useState<Record<number, string[]>>({})
  const [hasMore, setHasMore] = React.useState(false)
  // Bumped by the main process whenever the watcher or sync mutates documents.
  // Adding it to the search-effect deps causes a fresh query without forcing the
  // user to re-type or change filters.
  const [refreshKey, setRefreshKey] = React.useState(0)
  const [rescanning, setRescanning] = React.useState(false)
  const [dropActive, setDropActive] = React.useState(false)
  const [importNotice, setImportNotice] = React.useState<string | null>(null)
  // Tracks nested dragenter/dragleave so we keep the overlay visible while the
  // pointer crosses over a child element — only the outermost leave clears it.
  const dragDepthRef = React.useRef(0)
  // Multi-select state by document id. Anchor is used for shift-range selects.
  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(new Set())
  const anchorIdRef = React.useRef<number | null>(null)
  // Internal clipboard (cut/copy of rel_paths). Separate from the OS
  // clipboard — we never touch system clipboard for files.
  const [clipboard, setClipboard] = React.useState<{ mode: 'cut' | 'copy'; rel_paths: string[] } | null>(null)
  const [opNotice, setOpNotice] = React.useState<string | null>(null)

  // Effective filters include the currently-selected folder
  const effectiveFilters: Filters = React.useMemo(
    () => ({
      ...filters,
      folderRel: selectedFolder || null
    }),
    [filters, selectedFolder]
  )

  // Debounced search (page 0). Pagination "load more" handled separately.
  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const hits = await window.repsil.documents.search(query, effectiveFilters, {
          limit: PAGE_SIZE,
          offset: 0
        })
        if (cancelled) return
        setResults(hits)
        setHasMore(hits.length === PAGE_SIZE)
        const tagMap = await window.repsil.tags.forDocuments(hits.map((h) => h.id))
        if (!cancelled) setTagsByDoc(tagMap)
      } catch (err) {
        console.error('search failed:', err)
        if (!cancelled) {
          setResults([])
          setHasMore(false)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, effectiveFilters, settings.rootPath, refreshKey])

  const loadMore = async (): Promise<void> => {
    try {
      const hits = await window.repsil.documents.search(query, effectiveFilters, {
        limit: PAGE_SIZE,
        offset: results.length
      })
      setResults((prev) => [...prev, ...hits])
      setHasMore(hits.length === PAGE_SIZE)
      const tagMap = await window.repsil.tags.forDocuments(hits.map((h) => h.id))
      setTagsByDoc((prev) => ({ ...prev, ...tagMap }))
    } catch (err) {
      console.error('load more failed:', err)
    }
  }

  const reloadTree = React.useCallback(async () => {
    const t = await window.repsil.folders.tree()
    setFolderTree(t)
  }, [])

  const reloadTags = React.useCallback(async () => {
    const list = await window.repsil.tags.list()
    setTags(list)
  }, [])

  React.useEffect(() => {
    setSelectedFolder('')
    void reloadTree()
    void reloadTags()
  }, [reloadTree, reloadTags, settings.rootPath])

  // Auto-clear the import toast after 4s. User can also click to dismiss.
  React.useEffect(() => {
    if (!importNotice) return
    const timer = setTimeout(() => setImportNotice(null), 4000)
    return () => clearTimeout(timer)
  }, [importNotice])
  React.useEffect(() => {
    if (!opNotice) return
    const timer = setTimeout(() => setOpNotice(null), 3000)
    return () => clearTimeout(timer)
  }, [opNotice])

  // Reset the selection whenever the underlying result set changes — the
  // ids the user picked may no longer be in the list.
  React.useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev
      const visible = new Set(results.map((r) => r.id))
      const next = new Set<number>()
      for (const id of prev) if (visible.has(id)) next.add(id)
      return next.size === prev.size ? prev : next
    })
  }, [results])

  // Helper: rel_paths of the currently selected (in-order with results).
  const selectedRelPaths = React.useMemo(() => {
    if (selectedIds.size === 0) return []
    return results.filter((r) => selectedIds.has(r.id)).map((r) => r.rel_path)
  }, [results, selectedIds])

  const handleRowClick = (e: React.MouseEvent, id: number, index: number): void => {
    // Plain click in an active selection adjusts the selection; otherwise the
    // ResultRow's onOpen still navigates (handled by its own onClick).
    if (e.shiftKey && anchorIdRef.current !== null) {
      const anchorIndex = results.findIndex((r) => r.id === anchorIdRef.current)
      if (anchorIndex < 0) return
      const lo = Math.min(anchorIndex, index)
      const hi = Math.max(anchorIndex, index)
      const next = new Set<number>()
      for (let i = lo; i <= hi; i++) next.add(results[i].id)
      setSelectedIds(next)
      e.preventDefault()
      return
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      anchorIdRef.current = id
      e.preventDefault()
      return
    }
  }

  const runPaste = async (destOverride?: string): Promise<void> => {
    if (!clipboard || clipboard.rel_paths.length === 0) return
    const dest = destOverride ?? selectedFolder // '' = archive root
    const action = clipboard.mode === 'cut' ? window.repsil.documents.move : window.repsil.documents.copy
    let ok = 0
    let failed = 0
    let firstError: string | null = null
    for (const rel of clipboard.rel_paths) {
      const r = await action(rel, dest)
      if (r.ok) ok++
      else {
        failed++
        if (!firstError && r.error) firstError = r.error
      }
    }
    const base =
      clipboard.mode === 'cut'
        ? t('dashboard.pasteMoved', { count: ok, failed })
        : t('dashboard.pasteCopied', { count: ok, failed })
    setOpNotice(firstError && failed > 0 ? `${base} — ${firstError}` : base)
    if (clipboard.mode === 'cut') setClipboard(null)
  }

  const runBulkDelete = async (): Promise<void> => {
    if (selectedRelPaths.length === 0) return
    if (!confirm(t('dashboard.deleteSelectedConfirm', { count: selectedRelPaths.length }))) return
    let ok = 0
    let failed = 0
    for (const rel of selectedRelPaths) {
      const okOne = await window.repsil.documents.delete(rel)
      if (okOne) ok++
      else failed++
    }
    setOpNotice(t('dashboard.deletedCount', { count: ok, failed }))
    setSelectedIds(new Set())
  }

  /**
   * Right-click on a row resolves to "act on the multi-selection if this row is
   * part of it; otherwise replace the selection with just this row, then act".
   * Returns the list of rel_paths the action should run over.
   */
  const resolveContextTargets = (rowId: number, rowRel: string): string[] => {
    if (selectedIds.has(rowId) && selectedIds.size > 1) return selectedRelPaths
    // Right-clicking outside the selection: replace selection with this row so
    // the visual highlight matches what the action will hit.
    setSelectedIds(new Set([rowId]))
    return [rowRel]
  }

  const handleRowRename = async (rowId: number, rowRel: string, currentName: string): Promise<void> => {
    // Rename is always a single-file op even if multi-selected — we don't
    // batch-rename here (Stage 2 supports one at a time).
    setSelectedIds(new Set([rowId]))
    const next = prompt(t('document.renamePrompt'), currentName)
    if (next == null || next === currentName || !next.trim()) return
    const r = await window.repsil.documents.rename(rowRel, next.trim())
    if (!r.ok) {
      setOpNotice(t('document.renameFailed', { reason: r.error ?? '' }))
    }
  }

  const handleRowCut = (rowId: number, rowRel: string): void => {
    const targets = resolveContextTargets(rowId, rowRel)
    setClipboard({ mode: 'cut', rel_paths: targets })
    setOpNotice(t('dashboard.cutN', { count: targets.length }))
  }
  const handleRowCopy = (rowId: number, rowRel: string): void => {
    const targets = resolveContextTargets(rowId, rowRel)
    setClipboard({ mode: 'copy', rel_paths: targets })
    setOpNotice(t('dashboard.copiedN', { count: targets.length }))
  }
  const handleRowDelete = async (rowId: number, rowRel: string): Promise<void> => {
    const targets = resolveContextTargets(rowId, rowRel)
    if (!confirm(t('dashboard.deleteSelectedConfirm', { count: targets.length }))) return
    let ok = 0
    let failed = 0
    for (const rel of targets) {
      const okOne = await window.repsil.documents.delete(rel)
      if (okOne) ok++
      else failed++
    }
    setOpNotice(t('dashboard.deletedCount', { count: ok, failed }))
    setSelectedIds(new Set())
  }

  // Keyboard shortcuts. Skipped when the user is typing in an input/textarea
  // so the search box and metadata edits stay unimpaired.
  React.useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      const inEditable =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable === true
      if (inEditable) return
      // No-op when a dialog or sub-view owns the screen.
      if (settingsOpen || syncOpen || trashOpen || selectedId !== null) return

      const ctrl = e.ctrlKey || e.metaKey
      if (e.key === 'Escape') {
        setSelectedIds(new Set())
        return
      }
      if (ctrl && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        setSelectedIds(new Set(results.map((r) => r.id)))
        return
      }
      if (selectedRelPaths.length === 0 && !(ctrl && (e.key === 'v' || e.key === 'V'))) return

      if (ctrl && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault()
        setClipboard({ mode: 'cut', rel_paths: selectedRelPaths })
        setOpNotice(t('dashboard.cutN', { count: selectedRelPaths.length }))
        return
      }
      if (ctrl && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault()
        setClipboard({ mode: 'copy', rel_paths: selectedRelPaths })
        setOpNotice(t('dashboard.copiedN', { count: selectedRelPaths.length }))
        return
      }
      if (ctrl && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault()
        void runPaste()
        return
      }
      if (e.key === 'Delete') {
        e.preventDefault()
        void runBulkDelete()
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, selectedRelPaths, selectedFolder, clipboard, settingsOpen, syncOpen, trashOpen, selectedId])

  // Live document changes pushed by the main process (watcher add/remove/
  // change, plus metadata edits and sync apply). Bump refreshKey to re-run the
  // search, and reload the folder tree because a new file may have created a
  // new folder. Tags re-fetch happens implicitly inside the search effect.
  React.useEffect(() => {
    const off = window.repsil.documents.onChanged(() => {
      setRefreshKey((k) => k + 1)
      void reloadTree()
    })
    return off
  }, [reloadTree])

  // Live sync status for the status-bar indicator.
  React.useEffect(() => {
    let alive = true
    void window.repsil.sync.status().then((s) => {
      if (alive) setSyncStatus(s)
    })
    const off = window.repsil.sync.onChanged((s) => setSyncStatus(s))
    return () => {
      alive = false
      off()
    }
  }, [])

  // Poll queue status on a steady cadence for as long as the dashboard is
  // mounted. The self-scheduling guard checks `cancelled` BEFORE arming the
  // next timer, so an in-flight tick can't leak a timer the cleanup misses
  // (WR-08). No reactive deps — restarting the loop on results.length was what
  // produced overlapping timers.
  React.useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async (): Promise<void> => {
      try {
        const status = await window.repsil.extraction.status()
        if (cancelled) return
        setQueueStatus(status)
      } catch (err) {
        console.error('queue status poll failed:', err)
      }
      if (!cancelled) timer = setTimeout(() => void tick(), 1500)
    }
    void tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  const availableExts = React.useMemo(() => {
    const set = new Set<string>()
    for (const r of results) {
      const ext = r.filename.split('.').pop()?.toLowerCase()
      if (ext) set.add(ext)
    }
    return [...set].sort()
  }, [results])

  if (selectedId !== null) {
    return (
      <React.Suspense fallback={<div className="h-full w-full bg-bg" />}>
        <DocumentView
          id={selectedId}
          onBack={async () => {
            setSelectedId(null)
            await reloadTags()
          }}
        />
      </React.Suspense>
    )
  }

  if (trashOpen) {
    return (
      <React.Suspense fallback={<div className="h-full w-full bg-bg" />}>
        <TrashView onBack={() => setTrashOpen(false)} />
      </React.Suspense>
    )
  }

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = 0
    setDropActive(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) {
      setImportNotice(t('dashboard.importEmpty'))
      return
    }
    // Electron 32+ removed File.path; the preload bridge does the lookup via
    // webUtils.getPathForFile. Blobs without a real fs path resolve to '' and
    // are filtered out here.
    const paths = files.map((f) => window.repsil.documents.resolveDroppedPath(f)).filter(Boolean)
    if (paths.length === 0) {
      // The drop registered file-like objects but none had a real filesystem
      // path (could be a browser blob, a clipboard image, or a sandboxed
      // Explorer drop on a network share). Tell the user instead of silently
      // dropping the event.
      setImportNotice(t('dashboard.importNoPath', { count: files.length }))
      return
    }
    try {
      const r = await window.repsil.documents.import(paths, selectedFolder)
      const where = selectedFolder ? `/${selectedFolder}` : '/'
      const parts: string[] = []
      if (r.imported.length > 0) parts.push(t('dashboard.importedCount', { count: r.imported.length, dest: where }))
      if (r.skipped.length > 0) {
        // Surface the first skip reason inline — most batches share a single
        // root cause (perms, oversize, traversal). Massively easier to debug
        // than a bare "N skipped".
        const firstReason = r.skipped[0]?.reason ?? ''
        parts.push(t('dashboard.skippedCount', { count: r.skipped.length }) + (firstReason ? ` (${firstReason})` : ''))
      }
      if (parts.length === 0) {
        // Nothing imported, nothing skipped — likely the drop produced no
        // resolvable file paths at all. Tell the user something happened.
        setImportNotice(t('dashboard.importEmpty'))
      } else {
        setImportNotice(parts.join(' · '))
      }
    } catch (err) {
      console.error('import failed:', err)
      setImportNotice(t('dashboard.importFailed'))
    }
  }

  return (
    <>
      <div
        className="contents"
        onDragEnter={(e) => {
          if (!Array.from(e.dataTransfer.types).includes('Files')) return
          e.preventDefault()
          dragDepthRef.current++
          setDropActive(true)
        }}
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer.types).includes('Files')) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={(e) => {
          if (!Array.from(e.dataTransfer.types).includes('Files')) return
          e.preventDefault()
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
          if (dragDepthRef.current === 0) setDropActive(false)
        }}
        onDrop={(e) => void handleDrop(e)}
      >
      <WorkShell
        sidebar={
          <div className="flex h-full flex-col">
            <div className="border-b border-border px-3 py-2 text-w-small uppercase tracking-wider text-fg-muted">
              {t('dashboard.folders')}
            </div>
            <div className="min-h-0 flex-1">
              {folderTree && (
                <FolderTree
                  root={folderTree}
                  selectedRel={selectedFolder}
                  onSelect={setSelectedFolder}
                  onSetFolderSettings={async (s) => {
                    await window.repsil.folderSettings.set(s)
                    await reloadTree()
                  }}
                  onCreateFolder={async (parentRel, name) => {
                    const r = await window.repsil.folders.create(parentRel, name)
                    return r.ok ? null : r.error ?? 'failed'
                  }}
                  onMoveDocument={async (srcRel, destFolderRel) => {
                    const r = await window.repsil.documents.move(srcRel, destFolderRel)
                    return r.ok ? null : r.error ?? 'failed'
                  }}
                  hasClipboard={!!clipboard && clipboard.rel_paths.length > 0}
                  onPasteInto={(destFolderRel) => void runPaste(destFolderRel)}
                />
              )}
            </div>
            <button
              type="button"
              onClick={() => setTrashOpen(true)}
              className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2 text-start text-w-body text-fg-muted hover:bg-bg-elevated/60 hover:text-fg"
            >
              <Trash2 className="h-4 w-4" />
              <span className="flex-1 truncate">{t('trash.title')}</span>
            </button>
          </div>
        }
        topBar={
          <div className="flex w-full items-center gap-2">
            <div className="relative flex-1 max-w-2xl">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('dashboard.searchPlaceholder')}
                className={cn(
                  'h-9 w-full rounded-md border border-border bg-bg-elevated/60 ps-9 pe-3',
                  'text-w-body text-fg placeholder:text-fg-muted',
                  'focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'
                )}
              />
            </div>
            <SearchFilters
              value={filters}
              onChange={setFilters}
              availableTags={tags}
              availableExts={availableExts}
            />
            <button
              type="button"
              onClick={async () => {
                if (rescanning) return
                setRescanning(true)
                try {
                  await window.repsil.documents.rescan()
                } catch (err) {
                  console.error('rescan failed:', err)
                } finally {
                  setRescanning(false)
                }
              }}
              disabled={rescanning}
              className="rounded-md border border-border bg-bg-elevated/60 p-2 text-fg-muted hover:text-fg disabled:opacity-50"
              aria-label={t('dashboard.rescan')}
              title={t('dashboard.rescan')}
            >
              <RefreshCw className={cn('h-4 w-4', rescanning && 'animate-spin')} />
            </button>
            <button
              type="button"
              onClick={() => setSyncOpen(true)}
              className={cn(
                'relative rounded-md border border-border bg-bg-elevated/60 p-2 hover:text-fg',
                syncStatus && syncStatus.role !== 'idle' ? 'text-accent' : 'text-fg-muted'
              )}
              aria-label={t('sync.title')}
            >
              <Wifi className="h-4 w-4" />
              {syncStatus && syncStatus.role !== 'idle' && (
                <span className="absolute -end-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="rounded-md border border-border bg-bg-elevated/60 p-2 text-fg-muted hover:text-fg"
              aria-label={t('settings.title')}
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        }
        statusBar={
          <div className="flex w-full items-center justify-between gap-3">
            <span className="truncate font-mono text-w-small text-fg-muted">
              {settings.rootPath}
              {selectedFolder && <span className="text-fg"> / {selectedFolder}</span>}
            </span>
            <div className="flex items-center gap-3">
              <SyncIndicator status={syncStatus} />
              <QueueIndicator status={queueStatus} />
            </div>
          </div>
        }
      >
        <div className="mx-auto max-w-5xl px-6 py-6">
          {loading && results.length === 0 && (
            <div className="text-w-small text-fg-muted">…</div>
          )}
          {!loading && results.length === 0 && (
            <div className="rounded-lg border border-dashed border-border bg-bg-elevated/30 px-6 py-12 text-center text-w-body text-fg-muted">
              {query.trim()
                ? t('dashboard.noResults')
                : t('dashboard.emptyArchive')}
            </div>
          )}
          {results.length > 0 && (
            <>
              <ul className="divide-y divide-border rounded-lg border border-border bg-bg-elevated/30">
                {results.map((r, idx) => {
                  const cutMarked =
                    clipboard?.mode === 'cut' && clipboard.rel_paths.includes(r.rel_path)
                  return (
                    <ContextMenu.Root key={r.id}>
                      <ContextMenu.Trigger asChild>
                        <ResultRow
                          hit={r}
                          tags={tagsByDoc[r.id] ?? []}
                          selected={selectedIds.has(r.id)}
                          cutMarked={cutMarked}
                          onClickSelect={(e) => handleRowClick(e, r.id, idx)}
                          onOpen={() => {
                            anchorIdRef.current = r.id
                            setSelectedId(r.id)
                          }}
                        />
                      </ContextMenu.Trigger>
                      <ContextMenu.Portal>
                        <ContextMenu.Content className="z-50 min-w-[14rem] overflow-hidden rounded-md border border-border bg-bg-surface p-1 text-w-small shadow-soft">
                          <ContextMenu.Item
                            onSelect={() => {
                              anchorIdRef.current = r.id
                              setSelectedId(r.id)
                            }}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-fg outline-none data-[highlighted]:bg-bg-elevated"
                          >
                            <FileText className="h-3.5 w-3.5 text-fg-muted" />
                            {t('row.open')}
                          </ContextMenu.Item>
                          <ContextMenu.Item
                            onSelect={() => void handleRowRename(r.id, r.rel_path, r.filename)}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-fg outline-none data-[highlighted]:bg-bg-elevated"
                          >
                            <Pencil className="h-3.5 w-3.5 text-fg-muted" />
                            {t('row.rename')}
                          </ContextMenu.Item>
                          <ContextMenu.Separator className="my-1 h-px bg-border" />
                          <ContextMenu.Item
                            onSelect={() => handleRowCut(r.id, r.rel_path)}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-fg outline-none data-[highlighted]:bg-bg-elevated"
                          >
                            <Scissors className="h-3.5 w-3.5 text-fg-muted" />
                            {t('row.cut')}
                            <span className="ms-auto text-w-small text-fg-muted">Ctrl+X</span>
                          </ContextMenu.Item>
                          <ContextMenu.Item
                            onSelect={() => handleRowCopy(r.id, r.rel_path)}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-fg outline-none data-[highlighted]:bg-bg-elevated"
                          >
                            <CopyIcon className="h-3.5 w-3.5 text-fg-muted" />
                            {t('row.copy')}
                            <span className="ms-auto text-w-small text-fg-muted">Ctrl+C</span>
                          </ContextMenu.Item>
                          <ContextMenu.Item
                            onSelect={() => void handleRowDelete(r.id, r.rel_path)}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-destructive outline-none data-[highlighted]:bg-destructive/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {t('row.delete')}
                            <span className="ms-auto text-w-small text-fg-muted">Del</span>
                          </ContextMenu.Item>
                          <ContextMenu.Separator className="my-1 h-px bg-border" />
                          <ContextMenu.Item
                            onSelect={() => void window.repsil.documents.openExternal(r.rel_path)}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-fg outline-none data-[highlighted]:bg-bg-elevated"
                          >
                            <ExternalLink className="h-3.5 w-3.5 text-fg-muted" />
                            {t('document.openExternal')}
                          </ContextMenu.Item>
                          <ContextMenu.Item
                            onSelect={() => void window.repsil.documents.revealInFolder(r.rel_path)}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-fg outline-none data-[highlighted]:bg-bg-elevated"
                          >
                            <FolderOpen className="h-3.5 w-3.5 text-fg-muted" />
                            {t('document.revealInFolder')}
                          </ContextMenu.Item>
                        </ContextMenu.Content>
                      </ContextMenu.Portal>
                    </ContextMenu.Root>
                  )
                })}
              </ul>
              {hasMore && (
                <div className="mt-4 flex justify-center">
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    className="rounded-md border border-border bg-bg-elevated/60 px-4 py-2 text-w-small text-fg hover:border-accent-soft"
                  >
                    {t('dashboard.loadMore')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </WorkShell>
      {settingsOpen && (
        <React.Suspense fallback={null}>
          <SettingsSheet
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
        </React.Suspense>
      )}
      {syncOpen && (
        <React.Suspense fallback={null}>
          <SyncSheet
            open={syncOpen}
            onOpenChange={setSyncOpen}
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
        </React.Suspense>
      )}
      {dropActive && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-accent/15 backdrop-blur-sm">
          <div className="rounded-lg border-2 border-dashed border-accent bg-bg-surface/90 px-8 py-6 text-w-h2 font-semibold text-accent shadow-lg">
            {selectedFolder
              ? t('dashboard.dropToImportInto', { folder: selectedFolder })
              : t('dashboard.dropToImport')}
          </div>
        </div>
      )}
      {importNotice && (
        <div
          className="fixed bottom-6 start-1/2 z-50 -translate-x-1/2 cursor-pointer rounded-md border border-border bg-bg-surface px-4 py-2 text-w-small text-fg shadow-lg"
          onClick={() => setImportNotice(null)}
          role="status"
        >
          {importNotice}
        </div>
      )}
      {opNotice && (
        <div
          className="fixed bottom-20 start-1/2 z-50 -translate-x-1/2 cursor-pointer rounded-md border border-border bg-bg-surface px-4 py-2 text-w-small text-fg shadow-lg"
          onClick={() => setOpNotice(null)}
          role="status"
        >
          {opNotice}
        </div>
      )}
      {(selectedIds.size > 0 || clipboard) && (
        <div className="pointer-events-none fixed bottom-12 start-1/2 z-40 -translate-x-1/2">
          <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border bg-bg-surface px-3 py-1.5 text-w-small text-fg shadow-soft">
            {selectedIds.size > 0 && (
              <span className="text-fg">{t('dashboard.selectedCount', { count: selectedIds.size })}</span>
            )}
            {selectedIds.size > 0 && clipboard && <span className="text-fg-muted">·</span>}
            {clipboard && (
              <span className="text-fg-muted">
                {clipboard.mode === 'cut'
                  ? t('dashboard.clipboardCut', { count: clipboard.rel_paths.length })
                  : t('dashboard.clipboardCopy', { count: clipboard.rel_paths.length })}
              </span>
            )}
            {clipboard && (
              <button
                type="button"
                onClick={() => setClipboard(null)}
                className="rounded-md border border-border px-2 py-0.5 text-w-small text-fg-muted hover:text-fg"
              >
                {t('common.cancel')}
              </button>
            )}
          </div>
        </div>
      )}
      </div>
    </>
  )
}

function SyncIndicator({ status }: { status: SyncStatus | null }): JSX.Element {
  const { t } = useTranslation()
  if (!status || status.role === 'idle') return <span />
  const connected = status.peers.filter((p) => p.connected).length
  return (
    <span className="inline-flex items-center gap-1.5 text-accent">
      <Wifi className="h-3 w-3" />
      {connected > 0
        ? t('sync.syncing', { count: connected })
        : status.role === 'hosting'
          ? t('sync.statusHosting')
          : t('sync.statusJoined')}
    </span>
  )
}

interface ResultRowProps {
  hit: SearchResult
  tags: string[]
  onOpen: () => void
  onClickSelect?: (e: React.MouseEvent) => void
  selected?: boolean
  cutMarked?: boolean
}

const ResultRow = React.forwardRef<HTMLLIElement, ResultRowProps>(function ResultRow(
  { hit, tags, onOpen, onClickSelect, selected = false, cutMarked = false, ...rest },
  ref
): JSX.Element {
  const { t } = useTranslation()
  return (
    <li
      ref={ref}
      {...rest}
      draggable
      onDragStart={(e) => {
        // Custom MIME type so FolderTree can distinguish a row drag from a
        // file-from-Explorer drop without ambiguity.
        e.dataTransfer.setData('application/x-repsil-doc', hit.rel_path)
        e.dataTransfer.effectAllowed = 'move'
      }}
      className={cn(
        selected && 'bg-accent/10 ring-1 ring-accent ring-inset',
        cutMarked && 'opacity-60'
      )}
    >
      <button
        type="button"
        onClick={(e) => {
          // Modifier-click → toggle/extend selection; plain click → open.
          if (onClickSelect && (e.shiftKey || e.ctrlKey || e.metaKey)) {
            onClickSelect(e)
            return
          }
          onOpen()
        }}
        className="flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-bg-elevated/60"
      >
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-w-body text-fg">{hit.title || hit.filename}</div>
          <div className="mt-0.5 flex items-center gap-3 text-w-small text-fg-muted">
            <span className="truncate font-mono">{hit.rel_path}</span>
            {hit.doc_date && <span>{hit.doc_date}</span>}
            {hit.extraction_status === 'failed' && (
              <span className="inline-flex items-center gap-1 text-destructive" title={hit.error_message ?? ''}>
                <AlertCircle className="h-3 w-3" /> {t('dashboard.status_failed')}
              </span>
            )}
          </div>
          {tags.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <TagIcon className="h-3 w-3 text-fg-muted" />
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-pill bg-bg-surface px-1.5 py-0.5 text-w-small text-fg-muted"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          {hit.snippet && (
            <div
              className="mt-1 text-w-small text-fg [&_mark]:rounded [&_mark]:bg-accent-soft [&_mark]:px-1 [&_mark]:py-0.5 [&_mark]:text-fg"
              dangerouslySetInnerHTML={{ __html: hit.snippet }}
            />
          )}
        </div>
      </button>
    </li>
  )
})

function QueueIndicator({ status }: { status: ExtractionQueueStatus | null }): JSX.Element {
  const { t } = useTranslation()
  if (!status) return <span />
  const busy = status.queued + status.pendingInDb
  if (busy === 0) return <span>{t('dashboard.allIndexed')}</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <Loader2 className="h-3 w-3 animate-spin" />
      {t('dashboard.indexing', { count: busy })}
    </span>
  )
}
