import * as React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { Moon, Sun, X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { setLanguage } from '@renderer/i18n'
import { applyTheme } from '@renderer/theme/theme'
import type { AppSettings, DateFormat, Language, Theme } from '@shared/types'

interface SettingsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: AppSettings
  onSettingsChange: (next: AppSettings) => void
}

export function SettingsSheet({
  open,
  onOpenChange,
  settings,
  onSettingsChange
}: SettingsSheetProps): JSX.Element {
  const { t } = useTranslation()

  const update = async (patch: Partial<AppSettings>): Promise<void> => {
    const next = await window.repsil.settings.update(patch)
    onSettingsChange(next)
    if (patch.language) setLanguage(patch.language)
    if (patch.theme) applyTheme(patch.theme)
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
            <Dialog.Title className="text-w-h2 font-semibold text-fg">
              {t('settings.title')}
            </Dialog.Title>
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
            <Section title={t('settings.archive')}>
              <Row label={t('settings.rootPath')}>
                <span className="font-mono text-w-small text-fg-muted break-all">
                  {settings.rootPath ?? '—'}
                </span>
              </Row>
            </Section>

            <Section title={t('settings.appearance')}>
              <Row label={t('settings.language')}>
                <Segmented
                  options={[
                    { value: 'en', label: 'English' },
                    { value: 'ar', label: 'العربية' }
                  ]}
                  value={settings.language}
                  onChange={(v) => void update({ language: v as Language })}
                />
              </Row>
              <Row label={t('settings.theme')}>
                <Segmented
                  options={[
                    {
                      value: 'dark',
                      label: (
                        <span className="inline-flex items-center gap-1.5">
                          <Moon className="h-3.5 w-3.5" /> {t('settings.themeDark')}
                        </span>
                      )
                    },
                    {
                      value: 'light',
                      label: (
                        <span className="inline-flex items-center gap-1.5">
                          <Sun className="h-3.5 w-3.5" /> {t('settings.themeLight')}
                        </span>
                      )
                    }
                  ]}
                  value={settings.theme}
                  onChange={(v) => void update({ theme: v as Theme })}
                />
              </Row>
              {settings.theme === 'light' && (
                <p className="mt-1 text-w-small text-warning">
                  {t('settings.lightModeWarning')}
                </p>
              )}
            </Section>

            <Section title={t('settings.documents')}>
              <Row label={t('settings.dateFormat')}>
                <Segmented
                  options={[
                    { value: 'dmy', label: t('settings.dateDmy') },
                    { value: 'mdy', label: t('settings.dateMdy') }
                  ]}
                  value={settings.dateFormat}
                  onChange={(v) => void update({ dateFormat: v as DateFormat })}
                />
              </Row>
              <Row label={t('settings.pdfOcrMaxPages')}>
                <input
                  type="number"
                  min={1}
                  max={2000}
                  value={settings.pdfOcrMaxPages}
                  onChange={(e) => {
                    const n = Math.max(1, Math.min(2000, Number(e.target.value) || 1))
                    void update({ pdfOcrMaxPages: n })
                  }}
                  dir="ltr"
                  className="w-24 rounded border border-border bg-bg-elevated/60 px-2 py-1 text-end text-w-body text-fg"
                />
              </Row>
            </Section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section>
      <h3 className="mb-3 text-w-small uppercase tracking-wider text-fg-muted">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="pt-1 text-w-body text-fg">{label}</span>
      <div className="text-end">{children}</div>
    </div>
  )
}

interface SegmentedProps<V extends string> {
  options: { value: V; label: React.ReactNode }[]
  value: V
  onChange: (v: V) => void
}

function Segmented<V extends string>({ options, value, onChange }: SegmentedProps<V>): JSX.Element {
  return (
    <div className="inline-flex rounded-md border border-border bg-bg-elevated/60 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded px-3 py-1 text-w-small transition-colors',
            value === o.value ? 'bg-accent text-bg' : 'text-fg-muted hover:text-fg'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
