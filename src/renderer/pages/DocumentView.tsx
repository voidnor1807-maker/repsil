import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  ArrowLeft,
  ExternalLink,
  FileText,
  FolderOpen,
  Loader2,
  RotateCw,
  ScanText,
  Save
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { DirectionalIcon } from '@renderer/components/layout/DirectionalIcon'
import { TagInput } from '@renderer/components/TagInput'
import { cn } from '@renderer/lib/utils'
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

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'svg'])

function makeFileUrl(relPath: string): string {
  return `repsil-file://archive/${encodeURI(relPath)}`
}

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

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
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
    })()
    return () => {
      cancelled = true
    }
  }, [id])

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
      const fresh = await window.repsil.documents.get(id)
      if (!fresh) return
      if (fresh.extraction_status !== 'pending' || Date.now() - start > 120_000) {
        setDoc(fresh)
        setExtractedText(fresh.extracted_text ?? '')
        setOriginalExtractedText(fresh.extracted_text ?? '')
        return
      }
      setTimeout(() => void poll(), 1500)
    }
    setTimeout(() => void poll(), 1500)
  }

  if (!doc || !form) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg text-fg-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  const isPdf = doc.ext === 'pdf'
  const isImage = IMAGE_EXTS.has(doc.ext)
  const fileUrl = makeFileUrl(doc.rel_path)
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
      const fresh = await window.repsil.documents.get(id)
      if (!fresh) return
      if (fresh.extraction_status !== 'pending' || Date.now() - start > 120_000) {
        setDoc(fresh)
        setForm(toForm(fresh))
        setOriginal(toForm(fresh))
        return
      }
      setTimeout(() => void poll(), 1500)
    }
    setTimeout(() => void poll(), 1500)
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
          {!isPdf && !isImage && (
            <div className="m-auto flex flex-col items-center gap-3 text-fg-muted">
              <FileText className="h-8 w-8" />
              <span className="text-w-small">{t('document.noPreview')}</span>
            </div>
          )}
        </div>

        <aside className="flex w-96 shrink-0 flex-col border-s border-border bg-bg-surface">
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

          <section className="flex min-h-0 flex-1 flex-col p-4">
            <h2 className="mb-2 flex items-center gap-2 text-w-h2 font-semibold text-fg">
              {t('document.extractedText')}
              {doc.language && (
                <span className="rounded-pill border border-border bg-bg-elevated/60 px-2 py-0.5 text-w-small font-normal text-fg-muted">
                  {doc.language}
                </span>
              )}
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
