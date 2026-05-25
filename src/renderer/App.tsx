import * as React from 'react'
import { FirstRunWizard } from '@renderer/pages/FirstRunWizard'
import { DashboardPlaceholder } from '@renderer/pages/DashboardPlaceholder'
import { setLanguage } from '@renderer/i18n'
import type { AppSettings, Language } from '@shared/types'

type AppState =
  | { kind: 'loading' }
  | { kind: 'firstRun' }
  | { kind: 'ready'; rootPath: string }

export function App(): JSX.Element {
  const [state, setState] = React.useState<AppState>({ kind: 'loading' })

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const settings: AppSettings = await window.repsil.settings.get()
      if (cancelled) return
      setLanguage(settings.language)
      if (settings.firstRunComplete && settings.rootPath) {
        setState({ kind: 'ready', rootPath: settings.rootPath })
      } else {
        setState({ kind: 'firstRun' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleWizardComplete = async (input: {
    language: Language
    rootPath: string
  }): Promise<void> => {
    await window.repsil.settings.update({
      language: input.language,
      rootPath: input.rootPath,
      firstRunComplete: true
    })
    setState({ kind: 'ready', rootPath: input.rootPath })
  }

  if (state.kind === 'loading') {
    return <div className="h-full w-full bg-bg" />
  }
  if (state.kind === 'firstRun') {
    return <FirstRunWizard onComplete={handleWizardComplete} />
  }
  return <DashboardPlaceholder rootPath={state.rootPath} />
}
