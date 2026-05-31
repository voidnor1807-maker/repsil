import * as React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'

/**
 * Small modal dialog for prompting the user for a single string. Replaces
 * window.prompt(), which Chromium and Electron intentionally do not implement
 * (a bare prompt() call silently returns null). Controlled — caller owns the
 * open state and supplies onConfirm/onCancel handlers.
 *
 * Enter submits, Escape cancels, the input gets focus + selected text on open.
 * If validate() returns a non-empty string the OK button is disabled and the
 * message is shown under the input.
 */
export interface PromptDialogProps {
  open: boolean
  title: string
  description?: string
  initialValue?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
  validate?: (value: string) => string | null
  onCancel: () => void
  onConfirm: (value: string) => void | Promise<void>
}

export function PromptDialog({
  open,
  title,
  description,
  initialValue = '',
  placeholder,
  confirmLabel,
  cancelLabel,
  validate,
  onCancel,
  onConfirm
}: PromptDialogProps): JSX.Element {
  const { t } = useTranslation()
  const [value, setValue] = React.useState(initialValue)
  const [submitting, setSubmitting] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Reset state every time the dialog opens so a previous edit's value never
  // leaks into the next prompt.
  React.useEffect(() => {
    if (open) {
      setValue(initialValue)
      setSubmitting(false)
      // Focus + select after Radix has actually mounted the content.
      requestAnimationFrame(() => {
        const el = inputRef.current
        if (!el) return
        el.focus()
        el.select()
      })
    }
  }, [open, initialValue])

  const validationError = validate ? validate(value) : null
  const trimmed = value.trim()
  const canConfirm = !submitting && trimmed.length > 0 && !validationError

  const submit = async (): Promise<void> => {
    if (!canConfirm) return
    setSubmitting(true)
    try {
      await onConfirm(trimmed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out" />
        <Dialog.Content
          className={cn(
            'fixed start-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2',
            'rounded-lg border border-border bg-bg-surface p-5 shadow-soft outline-none',
            'data-[state=open]:animate-in data-[state=closed]:animate-out'
          )}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
              e.preventDefault()
              void submit()
            }
          }}
        >
          <Dialog.Title className="text-w-h2 font-semibold text-fg">{title}</Dialog.Title>
          {description && (
            <Dialog.Description className="mt-1 text-w-small text-fg-muted">
              {description}
            </Dialog.Description>
          )}
          <input
            ref={inputRef}
            type="text"
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            className={cn(
              'mt-4 w-full rounded-md border border-border bg-bg-elevated/60 px-3 py-2 text-w-body text-fg',
              'focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent',
              validationError && 'border-destructive focus:border-destructive focus:ring-destructive'
            )}
          />
          {validationError && (
            <div className="mt-1.5 text-w-small text-destructive">{validationError}</div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="rounded-md border border-border bg-bg-elevated/60 px-3 py-1.5 text-w-small text-fg hover:border-accent-soft disabled:opacity-50"
            >
              {cancelLabel ?? t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canConfirm}
              className="rounded-md border border-accent bg-accent/15 px-3 py-1.5 text-w-small text-accent hover:bg-accent/25 disabled:opacity-50"
            >
              {confirmLabel ?? t('common.save')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
