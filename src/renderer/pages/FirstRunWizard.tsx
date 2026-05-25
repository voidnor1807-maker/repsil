import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, ArrowLeft, FolderOpen, Check } from 'lucide-react'
import { ExpressiveShell } from '@renderer/components/layout/ExpressiveShell'
import { DirectionalIcon } from '@renderer/components/layout/DirectionalIcon'
import { Button } from '@renderer/components/ui/button'
import { PillButton } from '@renderer/components/primitives/PillButton'
import { cn } from '@renderer/lib/utils'
import { setLanguage } from '@renderer/i18n'
import type { Language } from '@shared/types'

interface FirstRunWizardProps {
  onComplete: (settings: { language: Language; rootPath: string }) => void
}

type Step = 1 | 2

export function FirstRunWizard({
  onComplete
}: FirstRunWizardProps): JSX.Element {
  const { t } = useTranslation()
  const [step, setStep] = React.useState<Step>(1)
  const [language, setLang] = React.useState<Language>('en')
  const [rootPath, setRootPath] = React.useState<string | null>(null)

  const handlePickLanguage = (lang: Language): void => {
    setLang(lang)
    setLanguage(lang)
  }

  const handleChooseFolder = async (): Promise<void> => {
    const result = await window.repsil.dialog.pickFolder()
    if (!result.canceled && result.path) {
      setRootPath(result.path)
    }
  }

  const handleFinish = (): void => {
    if (rootPath) {
      onComplete({ language, rootPath })
    }
  }

  return (
    <ExpressiveShell>
      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div
            key="step1"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="flex flex-col items-center"
          >
            <Badge>{t('firstRun.step1.badge')}</Badge>

            <h1 className="mt-6 text-e-display font-bold text-balance text-fg">
              {t('firstRun.step1.title')}
            </h1>
            <p className="mt-4 max-w-xl text-e-body text-fg-muted text-balance">
              {t('firstRun.step1.subtitle')}
            </p>

            <div className="mt-12 grid w-full max-w-xl gap-4 sm:grid-cols-2">
              <LanguageCard
                label={t('firstRun.step1.englishLabel')}
                native="English"
                selected={language === 'en'}
                onClick={() => handlePickLanguage('en')}
              />
              <LanguageCard
                label={t('firstRun.step1.arabicLabel')}
                native="العربية"
                selected={language === 'ar'}
                onClick={() => handlePickLanguage('ar')}
              />
            </div>

            <div className="mt-12 flex items-center gap-3">
              <PillButton onClick={() => setStep(2)}>
                {t('common.continue')}
                <DirectionalIcon>
                  <ArrowRight className="h-5 w-5" />
                </DirectionalIcon>
              </PillButton>
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div
            key="step2"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="flex flex-col items-center"
          >
            <Badge>{t('firstRun.step2.badge')}</Badge>

            <h1 className="mt-6 text-e-display font-bold text-balance text-fg">
              {t('firstRun.step2.title')}
            </h1>
            <p className="mt-4 max-w-xl text-e-body text-fg-muted text-balance">
              {t('firstRun.step2.subtitle')}
            </p>

            <button
              type="button"
              onClick={handleChooseFolder}
              className={cn(
                'mt-12 flex w-full max-w-xl items-center gap-3 rounded-lg border border-dashed border-border bg-bg-elevated/40 px-5 py-6 text-start',
                'transition-colors duration-150 hover:border-accent-soft hover:bg-bg-elevated'
              )}
            >
              <FolderOpen className="h-6 w-6 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="text-w-h2 font-medium text-fg">
                  {t('firstRun.step2.chooseFolder')}
                </div>
                <div className="mt-1 truncate font-mono text-w-small text-fg-muted">
                  {rootPath ?? t('firstRun.step2.noFolderYet')}
                </div>
              </div>
              {rootPath && (
                <Check className="h-5 w-5 shrink-0 text-success" />
              )}
            </button>

            <div className="mt-12 flex items-center gap-3">
              <Button variant="ghost" size="lg" onClick={() => setStep(1)}>
                <DirectionalIcon>
                  <ArrowLeft className="h-5 w-5" />
                </DirectionalIcon>
                {t('common.back')}
              </Button>
              <PillButton onClick={handleFinish} disabled={!rootPath}>
                {t('common.openArchive')}
                <DirectionalIcon>
                  <ArrowRight className="h-5 w-5" />
                </DirectionalIcon>
              </PillButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </ExpressiveShell>
  )
}

function Badge({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-2 rounded-pill border border-border bg-bg-surface/80 px-3 py-1 text-w-small text-fg-muted backdrop-blur">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_currentColor]" />
      {children}
    </span>
  )
}

function LanguageCard({
  label,
  native,
  selected,
  onClick
}: {
  label: string
  native: string
  selected: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex flex-col items-start gap-2 rounded-lg border bg-bg-elevated/60 px-5 py-5 text-start transition-all duration-150',
        'hover:border-accent-soft hover:bg-bg-elevated',
        selected
          ? 'border-accent shadow-[0_0_0_1px_theme(colors.accent.DEFAULT),0_0_24px_-6px_theme(colors.accent.glow)]'
          : 'border-border'
      )}
    >
      <span className="text-w-h2 font-semibold text-fg">{native}</span>
      <span className="text-w-small text-fg-muted">{label}</span>
      {selected && (
        <Check className="absolute end-4 top-4 h-4 w-4 text-accent" />
      )}
    </button>
  )
}
