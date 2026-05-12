import { useTranslation } from '../../i18n'

export function ClaudeOfficialLogin() {
  const t = useTranslation()

  return (
    <div className="text-sm text-[var(--color-text-secondary)] leading-6">
      {t('settings.claudeOfficialLogin.intro')}
    </div>
  )
}
