import { useTranslation } from 'react-i18next'
import { ExpressiveShell } from '@renderer/components/layout/ExpressiveShell'

interface DashboardPlaceholderProps {
  rootPath: string
}

/**
 * Stub for the post-wizard landing — Phase 1's real Dashboard arrives in
 * later steps (folder tree + document grid + viewer + search). For now this
 * just confirms the wizard handoff worked end-to-end.
 */
export function DashboardPlaceholder({
  rootPath
}: DashboardPlaceholderProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <ExpressiveShell>
      <span className="inline-flex items-center gap-2 rounded-pill border border-border bg-bg-surface/80 px-3 py-1 text-w-small text-fg-muted">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_8px_currentColor]" />
        {t('app.name')}
      </span>
      <h1 className="mt-6 text-e-display font-bold text-fg">
        {t('app.tagline')}
      </h1>
      <p className="mt-4 max-w-xl text-e-body text-fg-muted">
        Archive root:{' '}
        <span className="font-mono text-fg">{rootPath}</span>
      </p>
    </ExpressiveShell>
  )
}
