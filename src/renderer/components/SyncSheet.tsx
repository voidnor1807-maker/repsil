import * as React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { Check, Copy, Loader2, Radio, Wifi, X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { AppSettings, SyncStatus } from '@shared/types'

interface SyncSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: AppSettings
  onSettingsChange: (next: AppSettings) => void
}

const EMPTY: SyncStatus = { role: 'idle', code: null, peers: [], progress: { pending: 0, done: 0 }, error: null }

export function SyncSheet({ open, onOpenChange, settings, onSettingsChange }: SyncSheetProps): JSX.Element {
  const { t } = useTranslation()
  const [status, setStatus] = React.useState<SyncStatus>(EMPTY)
  const [tab, setTab] = React.useState<'host' | 'join'>('host')
  const [code, setCode] = React.useState('')
  const [name, setName] = React.useState(settings.deviceName)
  const [busy, setBusy] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [localErr, setLocalErr] = React.useState<string | null>(null)
  const noArchive = !settings.rootPath

  React.useEffect(() => {
    if (!open) return
    let alive = true
    void window.repsil.sync.status().then((s) => {
      if (alive) setStatus(s)
    })
    const off = window.repsil.sync.onChanged((s) => setStatus(s))
    return () => {
      alive = false
      off()
    }
  }, [open])

  const startHosting = async (): Promise<void> => {
    setBusy(true)
    setLocalErr(null)
    try {
      const res = await window.repsil.sync.host()
      if (!res.ok) setLocalErr(res.error)
    } finally {
      setBusy(false)
    }
  }

  const join = async (): Promise<void> => {
    if (!code.trim()) return
    setBusy(true)
    setLocalErr(null)
    try {
      const res = await window.repsil.sync.join(code.trim())
      if (!res.ok) setLocalErr(res.error)
    } finally {
      setBusy(false)
    }
  }

  const stop = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.repsil.sync.stop()
    } finally {
      setBusy(false)
    }
  }

  const copyCode = async (): Promise<void> => {
    if (!status.code) return
    await navigator.clipboard.writeText(status.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const saveName = async (): Promise<void> => {
    const next = await window.repsil.sync.setDeviceName(name)
    onSettingsChange(next)
    setName(next.deviceName)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-bg/70 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            'fixed end-0 top-0 z-50 h-full w-full max-w-md',
            'border-s border-border bg-bg-surface shadow-soft outline-none',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right'
          )}
        >
          <div className="flex h-12 items-center justify-between border-b border-border px-4">
            <Dialog.Title className="text-w-h2 font-semibold text-fg">{t('sync.title')}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label={t('common.cancel')}
                className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="space-y-6 p-4">
            {noArchive && (
              <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-w-small text-warning">
                {t('sync.needArchive')}
              </p>
            )}

            <label className="block">
              <div className="mb-1 text-w-small uppercase tracking-wider text-fg-muted">
                {t('sync.deviceName')}
              </div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => void saveName()}
                className="w-full rounded-md border border-border bg-bg-elevated/60 px-3 py-2 text-w-body text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>

            <div className="inline-flex w-full rounded-md border border-border bg-bg-elevated/60 p-0.5">
              {(['host', 'join'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setTab(v)}
                  className={cn(
                    'flex-1 rounded px-3 py-1.5 text-w-small transition-colors',
                    tab === v ? 'bg-accent text-bg' : 'text-fg-muted hover:text-fg'
                  )}
                >
                  {t(`sync.${v}`)}
                </button>
              ))}
            </div>

            {tab === 'host' ? (
              <section className="space-y-3">
                {status.role === 'hosting' && status.code ? (
                  <>
                    <p className="text-w-small text-fg-muted">{t('sync.hostingHint')}</p>
                    <div className="rounded-md border border-border bg-bg-elevated/40 p-3">
                      <div className="mb-1 text-w-small uppercase tracking-wider text-fg-muted">
                        {t('sync.code')}
                      </div>
                      <div className="flex items-start gap-2">
                        <code className="min-w-0 flex-1 break-all font-mono text-w-small text-fg">
                          {status.code}
                        </code>
                        <button
                          type="button"
                          onClick={() => void copyCode()}
                          className="inline-flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1 text-w-small text-fg-muted hover:text-fg"
                        >
                          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          {copied ? t('sync.copied') : t('sync.copy')}
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void stop()}
                      disabled={busy}
                      className="w-full rounded-md border border-destructive/40 px-3 py-2 text-w-body text-destructive hover:bg-destructive/10"
                    >
                      {t('sync.stopHosting')}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => void startHosting()}
                    disabled={busy || noArchive}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-w-body text-bg disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
                    {t('sync.startHosting')}
                  </button>
                )}
              </section>
            ) : (
              <section className="space-y-3">
                {status.role === 'joined' ? (
                  <button
                    type="button"
                    onClick={() => void stop()}
                    disabled={busy}
                    className="w-full rounded-md border border-destructive/40 px-3 py-2 text-w-body text-destructive hover:bg-destructive/10"
                  >
                    {t('sync.leave')}
                  </button>
                ) : (
                  <>
                    <p className="text-w-small text-fg-muted">{t('sync.joinHint')}</p>
                    <textarea
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder={t('sync.codePlaceholder')}
                      dir="ltr"
                      rows={3}
                      className="w-full resize-none rounded-md border border-border bg-bg-elevated/60 px-3 py-2 font-mono text-w-small text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    <button
                      type="button"
                      onClick={() => void join()}
                      disabled={busy || noArchive || !code.trim()}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-w-body text-bg disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
                      {t('sync.connect')}
                    </button>
                  </>
                )}
              </section>
            )}

            {(localErr || status.error) && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-w-small text-destructive">
                {localErr || status.error}
              </p>
            )}

            <section>
              <h3 className="mb-2 text-w-small uppercase tracking-wider text-fg-muted">
                {t('sync.peers')}
              </h3>
              {status.peers.length === 0 ? (
                <p className="text-w-small text-fg-muted">{t('sync.noPeers')}</p>
              ) : (
                <ul className="space-y-1">
                  {status.peers.map((p) => (
                    <li
                      key={p.deviceId}
                      className="flex items-center justify-between rounded border border-border bg-bg-elevated/40 px-3 py-1.5 text-w-small"
                    >
                      <span className="truncate text-fg">{p.name}</span>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1',
                          p.connected ? 'text-accent' : 'text-fg-muted'
                        )}
                      >
                        <span
                          className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            p.connected ? 'bg-accent' : 'bg-fg-muted'
                          )}
                        />
                        {p.connected ? t('sync.connected') : t('sync.disconnected')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
