import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  ArrowLeft,
  ExternalLink,
  FileText,
  FolderOpen,
  Loader2,
  Maximize2,
  Minimize2,
  Pencil,
  RotateCw,
  ScanText,
  Save,
  Trash2
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { DirectionalIcon } from '@renderer/components/layout/DirectionalIcon'
import { PromptDialog } from '@renderer/components/PromptDialog'
import { TagInput } from '@renderer/components/TagInput'
import { cn } from '@renderer/lib/utils'
import { PREVIEW_IMAGE_EXTS, PREVIEW_TEXT_EXTS } from '@shared/extensions'
import { makeRepsilFileUrl } from '@shared/repsilFile'
import type { DocumentDetail, DocumentMetadataPatch } from '@shared/types'

interface DocumentViewProps {
  id: number
  onBack: () => void
}

interface FormState {
  title: string
  doc_date: string
  source: string
  notes: string
}

// How often / how long we re-poll a document after kicking off extraction.
const POLL_INTERVAL_MS = 1500
const POLL_TIMEOUT_MS = 120_000

function toForm(doc: DocumentDetail): FormState {
  return {
    title: doc.title ?? '',
    doc_date: doc.doc_date ?? '',
    source: doc.source ?? '',
    notes: doc.notes ?? ''
  }
}

function diffForm(orig: FormState, current: FormState): DocumentMetadataPatch {
  const patch: DocumentMetadataPatch = {}
  if (orig.title !== current.title) patch.title = current.title
  if (orig.doc_date !== current.doc_date) patch.doc_date = current.doc_date
  if (orig.source !== current.source) patch.source = current.source
  if (orig.notes !== current.notes) patch.notes = current.notes
  return patch
}

export function DocumentView({ id, onBack }: DocumentViewProps): JSX.Element {
  const { t } = useTranslation()
  const [doc, setDoc] = React.useState<DocumentDetail | null>(null)
  const [form, setForm] = React.useState<FormState | null>(null)
  const [original, setOriginal] = React.useState<FormState | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [tags, setTags] = React.useState<string[]>([])
  const [originalTags, setOriginalTags] = React.useState<string[]>([])
  const [tagSuggestions, setTagSuggestions] = React.useState<string[]>([])
  const [extractedText, setExtractedText] = React.useState('')
  const [originalExtractedText, setOriginalExtractedText] = React.useState('')
  // When true, the extracted-text panel takes the whole DocumentView width;
  // preview + metadata are hidden. Toggled from the panel header.
  const [textExpanded, setTextExpanded] = React.useState(false)
  // Raw text/markdown preview, fetched from the repsil-file:// scheme.
  const [textPreview, setTextPreview] = React.useState<string | null>(null)
  const [textTruncated, setTextTruncated] = React.useState(false)
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [renameError, setRenameError] = React.useState<string | null>(null)
  // Cleared on unmount so background poll loops stop touching state (IN-03).
  const aliveRef = React.useRef(true)
  React.useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [fresh, docTags, allTags] = await Promise.all([
          window.repsil.documents.get(id),
          window.repsil.tags.forDocument(id),
          window.repsil.tags.list()
        ])
        if (cancelled || !fresh) return
        setDoc(fresh)
        const f = toForm(fresh)
        setForm(f)
        setOriginal(f)
        const names = docTags.map((t) => t.name)
        setTags(names)
        setOriginalTags(names)
        setTagSuggestions(allTags.map((t) => t.name))
        setExtractedText(fresh.extracted_text ?? '')
        setOriginalExtractedText(fresh.extracted_text ?? '')
      } catch (err) {
        console.error('failed to load document:', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  React.useEffect(() => {
    setTextPreview(null)
    setTextTruncated(false)
    if (!doc || !PREVIEW_TEXT_EXTS.has(doc.ext)) return
    let cancelled = false
    const MAX_BYTES = 1_000_000
    void (async () => {
      try {
        const res = await fetch(makeRepsilFileUrl(doc.rel_path))
        const buf = await res.arrayBuffer()
        if (cancelled) return
        const truncated = buf.byteLength > MAX_BYTES
        const view = truncated ? buf.slice(0, MAX_BYTES) : buf
        setTextPreview(new TextDecoder('utf-8').decode(view))
        setTextTruncated(truncated)
      } catch (err) {
        if (!cancelled) setTextPreview('')
        console.error('failed to load text preview:', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc?.rel_path, doc?.ext])

  const tagsDirty = !arraysEqual(tags, originalTags)
  const textDirty = extractedText !== originalExtractedText
  const formDirty = form && original ? Object.keys(diffForm(original, form)).length > 0 : false
  const dirty = formDirty || tagsDirty || textDirty

  const handleSave = async (): Promise<void> => {
    if (!form || !original || !doc) return
    setSaving(true)
    try {
      const patch = diffForm(original, form)
      if (Object.keys(patch).length > 0) {
        const updated = await window.repsil.documents.updateMetadata(id, patch)
        if (updated) {
          setDoc(updated)
          const f = toForm(updated)
          setForm(f)
          setOriginal(f)
        }
      }
      if (tagsDirty) {
        const fresh = await window.repsil.tags.setForDocument(id, tags)
        const names = fresh.map((t) => t.name)
        setTags(names)
        setOriginalTags(names)
      }
      if (textDirty) {
        await window.repsil.documents.setExtractedText(id, extractedText)
        setOriginalExtractedText(extractedText)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleRetry = async (): Promise<void> => {
    if (!doc) return
    await window.repsil.documents.retry(id)
    setDoc({ ...doc, extraction_status: 'pending', error_message: null })
    const start = Date.now()
    const poll = async (): Promise<void> => {
      if (!aliveRef.current) return
      const fresh = await window.repsil.documents.get(id)
      if (!aliveRef.current || !fresh) return
      if (fresh.extraction_status !== 'pending' || Date.now() - start > POLL_TIMEOUT_MS) {
        setDoc(fresh)
        setExtractedText(fresh.extracted_text ?? '')
        setOriginalExtractedText(fresh.extracted_text ?? '')
        return
      }
      setTimeout(() => void poll(), POLL_INTERVAL_MS)
    }
    setTimeout(() => void poll(), POLL_INTERVAL_MS)
  }

  if (!doc || !form) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg text-fg-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  const isPdf = doc.ext === 'pdf'
  const isImage = PREVIEW_IMAGE_EXTS.has(doc.ext)
  const isText = PREVIEW_TEXT_EXTS.has(doc.ext)
  const fileUrl = makeRepsilFileUrl(doc.rel_path)
  const editedFields = parseEdited(doc.user_edited_fields)
  const canOcr = isImage
  const ocrInProgress =
    doc.ocr_requested === 1 && doc.extraction_status === 'pending'

  const handleOcr = async (): Promise<void> => {
    const ok = await window.repsil.documents.requestOcr(id)
    if (!ok) return
    // Mark as pending locally so the button flips immediately
    setDoc({ ...doc, ocr_requested: 1, extraction_status: 'pending' })
    // Re-poll the doc until extraction finishes
    const start = Date.now()
    const poll = async (): Promise<void> => {
      if (!aliveRef.current) return
      const fresh = await window.repsil.documents.get(id)
      if (!aliveRef.current || !fresh) return
      if (fresh.extraction_status !== 'pending' || Date.now() - start > POLL_TIMEOUT_MS) {
        setDoc(fresh)
        setForm(toForm(fresh))
        setOriginal(toForm(fresh))
        setExtractedText(fresh.extracted_text ?? '')
        setOriginalExtractedText(fresh.extracted_text ?? '')
        return
      }
      setTimeout(() => void poll(), POLL_INTERVAL_MS)
    }
    setTimeout(() => void poll(), POLL_INTERVAL_MS)
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
          <div className="truncate text-w-body text-fg">{doc.title || doc.filename}</div>
          <div className="truncate font-mono text-w-small text-fg-muted">{doc.rel_path}</div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRenameOpen(true)}
          className="gap-1.5"
          title={t('document.rename')}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void window.repsil.documents.openExternal(doc.rel_path)}
          className="gap-1.5"
          title={t('document.openExternal')}
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void window.repsil.documents.revealInFolder(doc.rel_path)}
          className="gap-1.5"
          title={t('document.revealInFolder')}
        >
          <FolderOpen className="h-4 w-4" />
        </Button>
        {canOcr && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleOcr()}
            disabled={ocrInProgress}
            className="gap-1.5"
          >
            {ocrInProgress ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ScanText className="h-4 w-4" />
            )}
            {ocrInProgress ? t('document.ocrRunning') : t('document.runOcr')}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            if (!confirm(t('document.deleteConfirm'))) return
            const ok = await window.repsil.documents.delete(doc.rel_path)
            if (ok) onBack()
          }}
          className="gap-1.5 text-destructive hover:text-destructive"
          title={t('document.delete')}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          onClick={() => void handleSave()}
          disabled={!dirty || saving}
          className="gap-1.5"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t('common.save')}
        </Button>
      </div>

      {doc.extraction_status === 'failed' && (
        <div className="flex items-center gap-2 border-b border-border bg-destructive/10 px-4 py-2 text-w-small text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {doc.error_message || t('document.extractionFailed')}
          </span>
          <button
            type="button"
            onClick={() => void handleRetry()}
            className="inline-flex shrink-0 items-center gap-1 rounded border border-destructive/40 px-2 py-0.5 text-destructive hover:bg-destructive/15"
          >
            <RotateCw className="h-3 w-3" /> {t('document.retry')}
          </button>
        </div>
      )}
      {doc.extraction_status === 'not_applicable' && doc.error_message && (
        <div className="flex items-center gap-2 border-b border-border bg-warning/10 px-4 py-2 text-w-small text-warning">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{doc.error_message}</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {!textExpanded && (
        <div className="flex min-w-0 flex-1 items-stretch justify-center bg-bg-elevated/30">
          {isPdf && (
            <iframe
              key={fileUrl}
              title={doc.filename}
              src={`${fileUrl}#toolbar=1`}
              className="h-full w-full border-0"
            />
          )}
          {isImage && (
            <img
              src={fileUrl}
              alt={doc.filename}
              className="m-auto max-h-full max-w-full object-contain"
            />
          )}
          {isText &&
            (textPreview === null ? (
              <Loader2 className="m-auto h-5 w-5 animate-spin text-fg-muted" />
            ) : (
              <div className="h-full w-full overflow-auto p-4">
                <pre
                  dir={doc.language === 'ar' ? 'rtl' : 'ltr'}
                  className="whitespace-pre-wrap break-words font-mono text-w-small text-fg"
                >
                  {textPreview}
                </pre>
                {textTruncated && (
                  <p className="mt-3 text-w-small text-fg-muted">{t('document.truncatedPreview')}</p>
                )}
              </div>
            ))}
          {!isPdf && !isImage && !isText && (
            <div className="m-auto flex flex-col items-center gap-3 text-fg-muted">
              <FileText className="h-8 w-8" />
              <span className="text-w-small">{t('document.noPreview')}</span>
            </div>
          )}
        </div>
        )}

        <aside
          className={cn(
            'flex shrink-0 flex-col bg-bg-surface',
            textExpanded ? 'min-w-0 flex-1 border-s-0' : 'w-[28rem] border-s border-border'
          )}
        >
          {!textExpanded && (
          <section className="border-b border-border p-4">
            <h2 className="mb-3 text-w-h2 font-semibold text-fg">{t('document.metadata')}</h2>
            <Field
              label={t('document.fields.title')}
              edited={editedFields.has('title')}
              value={form.title}
              onChange={(v) => setForm({ ...form, title: v })}
            />
            <Field
              label={t('document.fields.docDate')}
              edited={editedFields.has('doc_date')}
              value={form.doc_date}
              type="date"
              dir="ltr"
              onChange={(v) => setForm({ ...form, doc_date: v })}
            />
            <Field
              label={t('document.fields.source')}
              edited={editedFields.has('source')}
              value={form.source}
              onChange={(v) => setForm({ ...form, source: v })}
            />
            <Field
              label={t('document.fields.notes')}
              edited={editedFields.has('notes')}
              value={form.notes}
              multiline
              onChange={(v) => setForm({ ...form, notes: v })}
            />
            <div className="mb-1 text-w-small text-fg-muted">{t('document.fields.tags')}</div>
            <TagInput
              value={tags}
              onChange={setTags}
              suggestions={tagSuggestions}
              placeholder={t('document.tagsPlaceholder')}
            />
          </section>
          )}

          <section className="flex min-h-0 flex-1 flex-col p-4">
            <h2 className="mb-2 flex items-center gap-2 text-w-h2 font-semibold text-fg">
              <span>{t('document.extractedText')}</span>
              {doc.language && (
                <span className="rounded-pill border border-border bg-bg-elevated/60 px-2 py-0.5 text-w-small font-normal text-fg-muted">
                  {doc.language}
                </span>
              )}
              <button
                type="button"
                onClick={() => setTextExpanded((v) => !v)}
                title={textExpanded ? t('document.collapseText') : t('document.expandText')}
                aria-label={textExpanded ? t('document.collapseText') : t('document.expandText')}
                className="ms-auto inline-flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-elevated hover:text-fg"
              >
                {textExpanded ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
              </button>
            </h2>
            <textarea
              dir={doc.language === 'ar' ? 'rtl' : 'ltr'}
              value={extractedText}
              onChange={(e) => setExtractedText(e.target.value)}
              placeholder={t('document.noExtractedText')}
              className="min-h-0 flex-1 resize-none overflow-auto rounded-md border border-border bg-bg-elevated/30 p-3 text-w-small text-fg whitespace-pre-wrap outline-none focus:border-accent focus:ring-1 focus:ring-accent placeholder:text-fg-muted"
            />
          </section>
        </aside>
      </div>

      <PromptDialog
        open={renameOpen}
        title={t('document.rename')}
        description={t('document.renamePrompt')}
        initialValue={doc.filename}
        confirmLabel={t('document.rename')}
        selectMode="stem"
        validate={(v) => {
          const trimmed = v.trim()
          if (!trimmed) return t('validate.required')
          if (trimmed.includes('/') || trimmed.includes('\\')) return t('validate.noSlashes')
          if (trimmed === '.' || trimmed === '..') return t('validate.reservedName')
          return null
        }}
        onCancel={() => {
          setRenameOpen(false)
          setRenameError(null)
        }}
        onConfirm={async (next) => {
          // Safety net for the rename dialog: if the user wiped the extension,
          // restore the original one. The preview path (isPdf/isImage/isText)
          // and the extraction pipeline all key off the extension, so dropping
          // it silently breaks previews — the screenshot bug. Trust an explicit
          // new extension though, since the user may be intentionally changing
          // the file type (foo.txt → foo.md).
          const newDot = next.lastIndexOf('.')
          const hasExt = newDot > 0 && newDot < next.length - 1
          const oldDot = doc.filename.lastIndexOf('.')
          const finalName = !hasExt && oldDot > 0 ? next + doc.filename.slice(oldDot) : next
          if (finalName === doc.filename) {
            setRenameOpen(false)
            return
          }
          const result = await window.repsil.documents.rename(doc.rel_path, finalName)
          if (!result.ok) {
            setRenameError(result.error ?? 'failed')
            alert(t('document.renameFailed', { reason: result.error ?? '' }))
            return
          }
          // Pull the fresh row so the header + sidebar fields reflect the new
          // name immediately.
          const fresh = await window.repsil.documents.get(id)
          if (fresh) {
            setDoc(fresh)
            const f = toForm(fresh)
            setForm(f)
            setOriginal(f)
          }
          setRenameOpen(false)
          setRenameError(null)
        }}
      />
      {renameError && (
        <div className="fixed bottom-6 start-1/2 z-50 -translate-x-1/2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-w-small text-destructive shadow-lg">
          {t('document.renameFailed', { reason: renameError })}
        </div>
      )}
    </div>
  )
}

interface FieldProps {
  label: string
  value: string
  edited: boolean
  onChange: (v: string) => void
  multiline?: boolean
  type?: string
  dir?: 'ltr' | 'rtl'
}

function Field({ label, value, edited, onChange, multiline, type, dir }: FieldProps): JSX.Element {
  const Tag = multiline ? 'textarea' : 'input'
  return (
    <label className="mb-3 block">
      <div className="mb-1 flex items-center justify-between gap-2 text-w-small text-fg-muted">
        <span>{label}</span>
        {edited && <span className="text-accent">●</span>}
      </div>
      <Tag
        value={value}
        type={multiline ? undefined : type ?? 'text'}
        dir={dir}
        onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
          onChange(e.target.value)
        }
        rows={multiline ? 4 : undefined}
        className={cn(
          'w-full rounded-md border border-border bg-bg-elevated/60 px-3 py-2 text-w-body text-fg',
          'focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'
        )}
      />
    </label>
  )
}

function parseEdited(json: string): Set<string> {
  try {
    const arr = JSON.parse(json) as unknown
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((v): v is string => typeof v === 'string'))
  } catch {
    return new Set()
  }
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return false
  }
  return true
}
