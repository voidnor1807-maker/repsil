import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, RotateCcw, Trash2, FileText } from 'lucide-react'
import { DirectionalIcon } from '@renderer/components/layout/DirectionalIcon'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import type { TrashItem } from '@shared/types'

interface TrashViewProps {
  onBack: () => void
}

function formatTimestamp(ts: number, locale: string): string {
  try {
    return new Date(ts).toLocaleString(locale)
  } catch {
    return new Date(ts).toISOString()
  }
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return ''
  const u = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

export function TrashView({ onBack }: TrashViewProps): JSX.Element {
  const { t, i18n } = useTranslation()
  const [items, setItems] = React.useState<TrashItem[] | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const reload = React.useCallback(async () => {
    const list = await window.repsil.trash.list()
    setItems(list)
  }, [])

  React.useEffect(() => {
    void reload()
    // Trash listing reuses the documents:changed broadcast — it fires whenever
    // a delete/restore/purge or peer tombstone arrives.
    const off = window.repsil.documents.onChanged(() => {
      void reload()
    })
    return off
  }, [reload])

  const handleRestore = async (id: string): Promise<void> => {
    setBusyId(id)
    try {
      await window.repsil.trash.restore(id)
    } finally {
      setBusyId(null)
    }
  }

  const handlePurge = async (id: string): Promise<void> => {
    if (!confirm(t('trash.purgeConfirm'))) return
    setBusyId(id)
    try {
      await window.repsil.trash.purge(id)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-bg text-fg">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-bg-surface px-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
          <DirectionalIcon>
            <ArrowLeft className="h-4 w-4" />
          </DirectionalIcon>
          {t('common.back')}
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-w-body text-fg">{t('trash.title')}</div>
          <div className="truncate text-w-small text-fg-muted">{t('trash.subtitle')}</div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-6">
          {items === null && <div className="text-w-small text-fg-muted">…</div>}
          {items !== null && items.length === 0 && (
            <div className="rounded-lg border border-dashed border-border bg-bg-elevated/30 px-6 py-12 text-center text-w-body text-fg-muted">
              {t('trash.empty')}
            </div>
          )}
          {items !== null && items.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border bg-bg-elevated/30">
              {items.map((it) => (
                <li key={it.trash_id} className="flex items-start gap-3 px-4 py-3">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-w-body text-fg">{it.snap_title || it.filename}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-3 text-w-small text-fg-muted">
                      <span className="truncate font-mono">{it.rel_path}</span>
                      {it.size_bytes != null && <span>{formatSize(it.size_bytes)}</span>}
                      <span>{formatTimestamp(it.deleted_at, i18n.language)}</span>
                      {it.deleted_by && (
                        <span className="rounded-pill border border-border px-1.5 py-0.5">
                          {t('trash.deletedBy', { device: it.deleted_by })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void handleRestore(it.trash_id)}
                      disabled={busyId === it.trash_id}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-elevated/60 px-3 py-1.5 text-w-small text-fg hover:border-accent-soft',
                        busyId === it.trash_id && 'opacity-50'
                      )}
                      title={t('trash.restore')}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {t('trash.restore')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handlePurge(it.trash_id)}
                      disabled={busyId === it.trash_id}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-w-small text-destructive hover:bg-destructive/20',
                        busyId === it.trash_id && 'opacity-50'
                      )}
                      title={t('trash.purge')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t('trash.purge')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
