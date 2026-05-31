import * as Popover from '@radix-ui/react-popover'
import { useTranslation } from 'react-i18next'
import { Filter, X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { SearchFilters as Filters, TagWithUsage } from '@shared/types'

/** Flattened folder entry for the panel's folder picker. `depth` controls the
 *  indent in the dropdown label; `rel` is the archive-relative path that gets
 *  written into the filter. */
export interface FolderChoice {
  rel: string
  name: string
  depth: number
}

interface SearchFiltersProps {
  value: Filters
  onChange: (next: Filters) => void
  availableTags: TagWithUsage[]
  availableExts: string[]
  availableFolders: FolderChoice[]
}

export function SearchFilters({
  value,
  onChange,
  availableTags,
  availableExts,
  availableFolders
}: SearchFiltersProps): JSX.Element {
  const { t } = useTranslation()
  const activeCount =
    (value.dateFrom ? 1 : 0) +
    (value.dateTo ? 1 : 0) +
    (value.exts?.length ?? 0) +
    (value.tagIds?.length ?? 0) +
    (value.folderRel ? 1 : 0)

  const setDateFrom = (v: string): void => onChange({ ...value, dateFrom: v || null })
  const setDateTo = (v: string): void => onChange({ ...value, dateTo: v || null })
  const toggleExt = (ext: string): void => {
    const set = new Set(value.exts ?? [])
    if (set.has(ext)) set.delete(ext)
    else set.add(ext)
    onChange({ ...value, exts: [...set] })
  }
  const toggleTag = (id: number): void => {
    const set = new Set(value.tagIds ?? [])
    if (set.has(id)) set.delete(id)
    else set.add(id)
    onChange({ ...value, tagIds: [...set] })
  }
  const setFolder = (rel: string): void => {
    // Empty string from the <select> sentinel means "any folder" — clear both
    // the rel and the recursive flag so the filter is a no-op.
    if (rel === '') {
      const { folderRel: _r, folderRecursive: _rec, ...rest } = value
      void _r
      void _rec
      onChange(rest)
      return
    }
    // A folder picked here is always recursive — the panel filter exists to
    // narrow a search across a subtree, not to mimic the sidebar's listing.
    onChange({ ...value, folderRel: rel, folderRecursive: true })
  }
  const clearAll = (): void => onChange({})

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-elevated/60 px-2.5 py-1.5 text-w-small text-fg',
            'hover:border-accent-soft',
            activeCount > 0 && 'border-accent text-accent'
          )}
        >
          <Filter className="h-3.5 w-3.5" />
          {t('filters.button')}
          {activeCount > 0 && (
            <span className="rounded-pill bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-fg">
              {activeCount}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-80 rounded-md border border-border bg-bg-surface p-4 text-w-small shadow-soft"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-w-h2 font-semibold text-fg">{t('filters.title')}</span>
            {activeCount > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="inline-flex items-center gap-1 text-fg-muted hover:text-fg"
              >
                <X className="h-3 w-3" /> {t('filters.clear')}
              </button>
            )}
          </div>

          <section className="mb-4">
            <div className="mb-1.5 text-fg-muted">{t('filters.dateRange')}</div>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={value.dateFrom ?? ''}
                onChange={(e) => setDateFrom(e.target.value)}
                dir="ltr"
                className="min-w-0 flex-1 rounded border border-border bg-bg-elevated/60 px-2 py-1 text-fg"
              />
              <span className="text-fg-muted">–</span>
              <input
                type="date"
                value={value.dateTo ?? ''}
                onChange={(e) => setDateTo(e.target.value)}
                dir="ltr"
                className="min-w-0 flex-1 rounded border border-border bg-bg-elevated/60 px-2 py-1 text-fg"
              />
            </div>
          </section>

          {availableFolders.length > 0 && (
            <section className="mb-4">
              <div className="mb-1.5 text-fg-muted">{t('filters.folder')}</div>
              <select
                value={value.folderRel ?? ''}
                onChange={(e) => setFolder(e.target.value)}
                dir="ltr"
                className="w-full rounded border border-border bg-bg-elevated/60 px-2 py-1 text-fg"
              >
                <option value="">{t('filters.anyFolder')}</option>
                {availableFolders.map((f) => (
                  <option key={f.rel} value={f.rel}>
                    {'  '.repeat(f.depth)}
                    {f.name}
                  </option>
                ))}
              </select>
            </section>
          )}

          {availableExts.length > 0 && (
            <section className="mb-4">
              <div className="mb-1.5 text-fg-muted">{t('filters.fileType')}</div>
              <div className="flex flex-wrap gap-1">
                {availableExts.map((ext) => {
                  const active = value.exts?.includes(ext)
                  return (
                    <button
                      key={ext}
                      type="button"
                      onClick={() => toggleExt(ext)}
                      className={cn(
                        'rounded-pill border px-2 py-0.5 font-mono text-w-small',
                        active
                          ? 'border-accent bg-accent/15 text-accent'
                          : 'border-border bg-bg-elevated/60 text-fg-muted hover:border-accent-soft'
                      )}
                    >
                      .{ext}
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {availableTags.length > 0 && (
            <section>
              <div className="mb-1.5 flex items-center justify-between text-fg-muted">
                <span>{t('filters.tags')}</span>
                {(value.tagIds?.length ?? 0) > 1 && (
                  <button
                    type="button"
                    onClick={() => onChange({ ...value, anyTag: !value.anyTag })}
                    className="rounded border border-border px-1.5 py-0.5 text-[11px] text-fg hover:border-accent-soft"
                  >
                    {value.anyTag ? t('filters.matchAny') : t('filters.matchAll')}
                  </button>
                )}
              </div>
              <div className="flex max-h-40 flex-wrap gap-1 overflow-auto">
                {availableTags.map((tag) => {
                  const active = value.tagIds?.includes(tag.id)
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className={cn(
                        'rounded-pill border px-2 py-0.5 text-w-small',
                        active
                          ? 'border-accent bg-accent/15 text-accent'
                          : 'border-border bg-bg-elevated/60 text-fg-muted hover:border-accent-soft'
                      )}
                    >
                      {tag.name}
                    </button>
                  )
                })}
              </div>
            </section>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
