import * as React from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Folder, FolderOpen, Check, MoreVertical } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { FolderNode, FolderSettings } from '@shared/types'

interface FolderTreeProps {
  root: FolderNode
  selectedRel: string | null
  onSelect: (rel: string) => void
  onSetFolderSettings: (settings: FolderSettings) => void
}

export function FolderTree({
  root,
  selectedRel,
  onSelect,
  onSetFolderSettings
}: FolderTreeProps): JSX.Element {
  return (
    <div className="select-none overflow-auto py-2 text-w-small">
      <FolderRow
        node={root}
        depth={0}
        labelOverride="/"
        selectedRel={selectedRel}
        onSelect={onSelect}
        onSetFolderSettings={onSetFolderSettings}
        defaultOpen
      />
    </div>
  )
}

interface FolderRowProps {
  node: FolderNode
  depth: number
  labelOverride?: string
  selectedRel: string | null
  onSelect: (rel: string) => void
  onSetFolderSettings: (settings: FolderSettings) => void
  defaultOpen?: boolean
}

function FolderRow({
  node,
  depth,
  labelOverride,
  selectedRel,
  onSelect,
  onSetFolderSettings,
  defaultOpen
}: FolderRowProps): JSX.Element {
  const { t } = useTranslation()
  const toggleOcr = (): void =>
    onSetFolderSettings({
      rel_path: node.rel_path,
      ocr_default: !node.ocr_default,
      local_only: node.local_only
    })
  const toggleLocalOnly = (): void =>
    onSetFolderSettings({
      rel_path: node.rel_path,
      ocr_default: node.ocr_default,
      local_only: !node.local_only
    })
  const [open, setOpen] = React.useState(defaultOpen ?? depth < 1)
  const selected = selectedRel === node.rel_path
  const hasChildren = node.children.length > 0

  return (
    <div>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              onSelect(node.rel_path)
              if (hasChildren) setOpen(true)
            }}
            onDoubleClick={() => setOpen((o) => !o)}
            className={cn(
              'group flex items-center gap-1 px-2 py-1 transition-colors',
              selected ? 'bg-accent/15 text-fg' : 'text-fg hover:bg-bg-elevated/60'
            )}
            style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
          >
            {hasChildren ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setOpen((o) => !o)
                }}
                className="shrink-0 text-fg-muted hover:text-fg"
                aria-label={open ? 'collapse' : 'expand'}
              >
                <ChevronRight
                  className={cn('h-3 w-3 transition-transform', open && 'rotate-90')}
                />
              </button>
            ) : (
              <span className="h-3 w-3 shrink-0" />
            )}
            {open ? (
              <FolderOpen className="h-4 w-4 shrink-0 text-fg-muted" />
            ) : (
              <Folder className="h-4 w-4 shrink-0 text-fg-muted" />
            )}
            <span className="min-w-0 flex-1 truncate">
              {labelOverride ?? node.name}
            </span>
            {node.ocr_default && (
              <span
                title={t('folder.enableOcr')}
                className="shrink-0 rounded-pill bg-accent/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-accent"
              >
                OCR
              </span>
            )}
            {node.local_only && (
              <span
                title={t('folder.localOnly')}
                className="shrink-0 rounded-pill bg-fg-muted/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-fg-muted"
              >
                LOCAL
              </span>
            )}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 rounded p-0.5 text-fg-muted opacity-0 transition-opacity hover:bg-bg-elevated hover:text-fg focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                  aria-label="Folder options"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  className="z-50 min-w-[14rem] overflow-hidden rounded-md border border-border bg-bg-surface p-1 text-w-small shadow-soft"
                >
                  <DropdownMenu.Item
                    onSelect={toggleOcr}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-fg outline-none data-[highlighted]:bg-bg-elevated"
                  >
                    <span className="inline-flex h-3 w-3 items-center justify-center">
                      {node.ocr_default && <Check className="h-3 w-3 text-accent" />}
                    </span>
                    {t('folder.enableOcr')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={toggleLocalOnly}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-fg outline-none data-[highlighted]:bg-bg-elevated"
                  >
                    <span className="inline-flex h-3 w-3 items-center justify-center">
                      {node.local_only && <Check className="h-3 w-3 text-accent" />}
                    </span>
                    {t('folder.localOnly')}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className="z-50 min-w-[14rem] overflow-hidden rounded-md border border-border bg-bg-surface p-1 text-w-small shadow-soft">
            <ContextMenu.Item
              onSelect={toggleOcr}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-fg outline-none data-[highlighted]:bg-bg-elevated"
            >
              <span className="inline-flex h-3 w-3 items-center justify-center">
                {node.ocr_default && <Check className="h-3 w-3 text-accent" />}
              </span>
              {t('folder.enableOcr')}
            </ContextMenu.Item>
            <ContextMenu.Item
              onSelect={toggleLocalOnly}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-fg outline-none data-[highlighted]:bg-bg-elevated"
            >
              <span className="inline-flex h-3 w-3 items-center justify-center">
                {node.local_only && <Check className="h-3 w-3 text-accent" />}
              </span>
              {t('folder.localOnly')}
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {open && hasChildren && (
        <div>
          {node.children.map((c) => (
            <FolderRow
              key={c.rel_path}
              node={c}
              depth={depth + 1}
              selectedRel={selectedRel}
              onSelect={onSelect}
              onSetFolderSettings={onSetFolderSettings}
            />
          ))}
        </div>
      )}
    </div>
  )
}
