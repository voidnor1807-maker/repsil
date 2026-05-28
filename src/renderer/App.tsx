import * as React from 'react'
import { FirstRunWizard } from '@renderer/pages/FirstRunWizard'
import { Dashboard } from '@renderer/pages/Dashboard'
import { setLanguage } from '@renderer/i18n'
import { applyTheme } from '@renderer/theme/theme'
import type { AppSettings, Language } from '@shared/types'

type AppState =
  | { kind: 'loading' }
  | { kind: 'firstRun' }
  | { kind: 'ready'; settings: AppSettings }

export function App(): JSX.Element {
  const [state, setState] = React.useState<AppState>({ kind: 'loading' })

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const settings: AppSettings = await window.repsil.settings.get()
      if (cancelled) return
      setLanguage(settings.language)
      applyTheme(settings.theme)
      if (settings.firstRunComplete && settings.rootPath) {
        setState({ kind: 'ready', settings })
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
    const next = await window.repsil.settings.update({
      language: input.language,
      rootPath: input.rootPath,
      firstRunComplete: true
    })
    setState({ kind: 'ready', settings: next })
  }

  if (state.kind === 'loading') {
    return <div className="h-full w-full bg-bg" />
  }
  if (state.kind === 'firstRun') {
    return <FirstRunWizard onComplete={handleWizardComplete} />
  }
  return (
    <Dashboard
      settings={state.settings}
      onSettingsChange={(s) => setState({ kind: 'ready', settings: s })}
    />
  )
}
