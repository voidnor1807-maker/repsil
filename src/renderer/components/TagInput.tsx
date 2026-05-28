import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

interface TagInputProps {
  value: string[]
  onChange: (next: string[]) => void
  suggestions?: string[]
  placeholder?: string
}

export function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder
}: TagInputProps): JSX.Element {
  const [draft, setDraft] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  const addTag = (raw: string): void => {
    const name = raw.trim()
    if (!name) return
    if (value.some((t) => t.toLowerCase() === name.toLowerCase())) {
      setDraft('')
      return
    }
    onChange([...value, name])
    setDraft('')
  }

  const removeTag = (name: string): void => {
    onChange(value.filter((t) => t !== name))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(draft)
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      removeTag(value[value.length - 1])
    }
  }

  const filteredSuggestions = React.useMemo(() => {
    const lower = draft.trim().toLowerCase()
    if (!lower) return []
    return suggestions
      .filter(
        (s) =>
          s.toLowerCase().includes(lower) &&
          !value.some((t) => t.toLowerCase() === s.toLowerCase())
      )
      .slice(0, 6)
  }, [draft, suggestions, value])

  return (
    <div className="relative">
      <div
        className={cn(
          'flex min-h-[36px] flex-wrap items-center gap-1 rounded-md border border-border bg-bg-elevated/60 p-1.5',
          'focus-within:border-accent focus-within:ring-1 focus-within:ring-accent'
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-pill bg-bg-surface px-2 py-0.5 text-w-small text-fg"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="text-fg-muted hover:text-fg"
              aria-label={`Remove ${tag}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => draft && addTag(draft)}
          placeholder={value.length === 0 ? placeholder : undefined}
          className="min-w-[100px] flex-1 border-0 bg-transparent px-1 py-0.5 text-w-body text-fg outline-none placeholder:text-fg-muted"
        />
      </div>
      {filteredSuggestions.length > 0 && (
        <ul className="absolute start-0 z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-bg-surface shadow-soft">
          {filteredSuggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  addTag(s)
                }}
                className="block w-full px-3 py-1.5 text-start text-w-small text-fg hover:bg-bg-elevated"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
