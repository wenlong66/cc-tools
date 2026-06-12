import { useEffect, useMemo, useState } from 'react'
import {
  skillsApi,
  type CachedGitRepoRecord,
  type CachedGitSkill,
} from '../../api/skills'
import { useSkillStore } from '../../stores/skillStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTranslation } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import { Button } from '../shared/Button'
import { Modal } from '../shared/Modal'
import type { SkillMeta, SkillSource } from '../../types/skill'

const SOURCE_ORDER: SkillSource[] = ['user', 'project', 'plugin', 'mcp', 'bundled']

type InstallSourceMode = 'directory' | 'git'
type InstallScope = 'user' | 'project'

const SOURCE_ICONS: Record<SkillSource, string> = {
  user: 'person',
  project: 'folder',
  plugin: 'extension',
  mcp: 'hub',
  bundled: 'inventory_2',
}

const SOURCE_ACCENT_CLASSES: Record<SkillSource, string> = {
  user: 'bg-[var(--color-primary-fixed)] text-[var(--color-brand)]',
  project: 'bg-[var(--color-success-container)] text-[var(--color-success)]',
  plugin: 'bg-[var(--color-warning-container)] text-[var(--color-warning)]',
  mcp: 'bg-[var(--color-info-container)] text-[var(--color-info)]',
  bundled: 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]',
}

function estimateTokens(contentLength: number) {
  return Math.ceil(contentLength / 4)
}

function isTauriRuntime() {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  )
}

function normalizeOptionalValue(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function SkillList() {
  const { skills, isLoading, error, fetchSkills, fetchSkillDetail } =
    useSkillStore()
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const addToast = useUIStore((s) => s.addToast)
  const t = useTranslation()
  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const currentWorkDir = activeSession?.workDir || undefined
  const [searchQuery, setSearchQuery] = useState('')
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false)
  const [installMode, setInstallMode] = useState<InstallSourceMode>('directory')
  const [installPath, setInstallPath] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [repoRef, setRepoRef] = useState('')
  const [installScope, setInstallScope] = useState<InstallScope>('user')
  const [isInstalling, setIsInstalling] = useState(false)
  const [isCachingGitRepo, setIsCachingGitRepo] = useState(false)
  const [isLoadingCachedGitRepos, setIsLoadingCachedGitRepos] = useState(false)
  const [cachedGitRepos, setCachedGitRepos] = useState<CachedGitRepoRecord[]>([])
  const [expandedRepoIds, setExpandedRepoIds] = useState<Record<string, boolean>>({})
  const [expandedSkillDescriptions, setExpandedSkillDescriptions] = useState<Record<string, boolean>>({})
  const [expandedInstalledSkillDescriptions, setExpandedInstalledSkillDescriptions] = useState<Record<string, boolean>>({})
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase()

  useEffect(() => {
    void fetchSkills(currentWorkDir)
  }, [fetchSkills, currentWorkDir])

  useEffect(() => {
    if (!isInstallModalOpen || installMode !== 'git') {
      return
    }

    void loadCachedGitRepos(currentWorkDir)
  }, [installMode, isInstallModalOpen, currentWorkDir])

  const filteredSkills = useMemo(() => {
    if (!normalizedSearchQuery) return skills

    return skills.filter((skill) => {
      const fields = [
        skill.name,
        skill.displayName,
        skill.description,
        skill.source,
        t(`settings.skills.source.${skill.source}`),
        skill.version,
        skill.pluginName,
      ]

      return fields.some((field) =>
        field?.toLocaleLowerCase().includes(normalizedSearchQuery),
      )
    })
  }, [skills, normalizedSearchQuery, t])

  const grouped = useMemo(() => {
    const result: Partial<Record<SkillSource, SkillMeta[]>> = {}
    for (const skill of filteredSkills) {
      const src = skill.source as SkillSource
      ;(result[src] ??= []).push(skill)
    }
    return result
  }, [filteredSkills])

  const totalTokens = useMemo(
    () =>
      filteredSkills.reduce(
        (sum, skill) => sum + estimateTokens(skill.contentLength),
        0,
      ),
    [filteredSkills],
  )

  const visibleGroupCount = useMemo(
    () =>
      SOURCE_ORDER.filter((source) => (grouped[source] ?? []).length > 0).length,
    [grouped],
  )

  function resetInstallForm() {
    setInstallMode('directory')
    setInstallPath('')
    setRepoUrl('')
    setRepoRef('')
    setInstallScope('user')
    setCachedGitRepos([])
  }

  async function loadCachedGitRepos(cwd?: string) {
    setIsLoadingCachedGitRepos(true)
    try {
      const { records } = await skillsApi.listCachedGitRepos(cwd)
      setCachedGitRepos(records)
      setExpandedRepoIds((current) =>
        records.reduce<Record<string, boolean>>(
          (next, record) => ({
            ...next,
            [record.id]: current[record.id] ?? true,
          }),
          {},
        ),
      )
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsLoadingCachedGitRepos(false)
    }
  }

  const handleOpenInstallModal = () => {
    resetInstallForm()
    setIsInstallModalOpen(true)
  }

  const handleBrowseInstallPath = async () => {
    if (!isTauriRuntime()) {
      return
    }

    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('settings.skills.installBrowse'),
      })
      if (typeof selected === 'string' && selected.trim()) {
        setInstallPath(selected)
      }
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const handleInstallDirectorySkill = async () => {
    if (installMode !== 'directory') {
      return
    }

    if (installScopeNeedsProject(installScope, currentWorkDir)) {
      addToast({
        type: 'error',
        message: t('settings.skills.installProjectUnavailable'),
      })
      return
    }

    const normalizedPath = installPath.trim()
    if (!normalizedPath) {
      addToast({
        type: 'error',
        message: t('settings.skills.installPathRequired'),
      })
      return
    }

    setIsInstalling(true)
    try {
      const { message } = await skillsApi.install({
        mode: 'directory',
        path: normalizedPath,
        scope: installScope,
        ...(currentWorkDir ? { cwd: currentWorkDir } : {}),
      })
      await fetchSkills(currentWorkDir)
      setIsInstallModalOpen(false)
      addToast({ type: 'success', message })
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsInstalling(false)
    }
  }

  const handleCacheGitRepo = async () => {
    const normalizedRepoUrl = repoUrl.trim()
    if (!normalizedRepoUrl) {
      addToast({
        type: 'error',
        message: t('settings.skills.gitRepoUrlRequired'),
      })
      return
    }

    setIsCachingGitRepo(true)
    try {
      const { message } = await skillsApi.addCachedGitRepo({
        repoUrl: normalizedRepoUrl,
        ...(normalizeOptionalValue(repoRef) ? { ref: normalizeOptionalValue(repoRef) } : {}),
        ...(currentWorkDir ? { cwd: currentWorkDir } : {}),
      })
      await loadCachedGitRepos(currentWorkDir)
      addToast({ type: 'success', message })
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsCachingGitRepo(false)
    }
  }

  const handleInstallCachedGitSkill = async (
    repo: CachedGitRepoRecord,
    skill: CachedGitSkill,
    scope: InstallScope,
  ) => {
    if (installScopeNeedsProject(scope, currentWorkDir)) {
      addToast({
        type: 'error',
        message: t('settings.skills.installProjectUnavailable'),
      })
      return
    }

    setIsInstalling(true)
    try {
      const { message } = await skillsApi.install({
        mode: 'git',
        repoUrl: repo.repoUrl,
        ...(repo.ref ? { ref: repo.ref } : {}),
        ...(skill.skillPath ? { skillPath: skill.skillPath } : {}),
        scope,
        ...(currentWorkDir ? { cwd: currentWorkDir } : {}),
      })
      await Promise.all([
        fetchSkills(currentWorkDir),
        loadCachedGitRepos(currentWorkDir),
      ])
      addToast({ type: 'success', message })
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsInstalling(false)
    }
  }

  const handleInstallAllCachedGitSkills = async (
    repo: CachedGitRepoRecord,
    scope: InstallScope,
  ) => {
    if (installScopeNeedsProject(scope, currentWorkDir)) {
      addToast({
        type: 'error',
        message: t('settings.skills.installProjectUnavailable'),
      })
      return
    }

    setIsInstalling(true)
    try {
      for (const skill of repo.skills) {
        await skillsApi.install({
          mode: 'git',
          repoUrl: repo.repoUrl,
          ...(repo.ref ? { ref: repo.ref } : {}),
          ...(skill.skillPath ? { skillPath: skill.skillPath } : {}),
          scope,
          ...(currentWorkDir ? { cwd: currentWorkDir } : {}),
        })
      }
      await Promise.all([
        fetchSkills(currentWorkDir),
        loadCachedGitRepos(currentWorkDir),
      ])
      addToast({
        type: 'success',
        message: t('settings.skills.installAllSuccess', {
          count: String(repo.skills.length),
        }),
      })
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsInstalling(false)
    }
  }

  const handleDeleteSkill = async (skill: SkillMeta) => {
    if (skill.source !== 'user' && skill.source !== 'project') {
      return
    }

    try {
      const { message } = await skillsApi.remove(
        skill.source,
        skill.name,
        currentWorkDir,
      )
      await Promise.all([
        fetchSkills(currentWorkDir),
        loadCachedGitRepos(currentWorkDir),
      ])
      addToast({ type: 'success', message })
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const toggleCachedRepoExpanded = (repoId: string) => {
    setExpandedRepoIds((current) => ({
      ...current,
      [repoId]: !(current[repoId] ?? true),
    }))
  }

  const toggleSkillDescriptionExpanded = (key: string) => {
    setExpandedSkillDescriptions((current) => ({
      ...current,
      [key]: !(current[key] ?? false),
    }))
  }

  const toggleInstalledSkillDescriptionExpanded = (key: string) => {
    setExpandedInstalledSkillDescriptions((current) => ({
      ...current,
      [key]: !(current[key] ?? false),
    }))
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin w-5 h-5 border-2 border-[var(--color-brand)] border-t-transparent rounded-full" />
      </div>
    )
  }

  if (error) {
    return <div className="text-sm text-[var(--color-error)] py-4">{error}</div>
  }

  const installModalFooter =
    installMode === 'directory' ? (
      <>
        <Button
          variant="secondary"
          onClick={() => setIsInstallModalOpen(false)}
          disabled={isInstalling}
        >
          {t('settings.skills.cancel')}
        </Button>
        <Button onClick={() => void handleInstallDirectorySkill()} loading={isInstalling}>
          {t('settings.skills.installSubmit')}
        </Button>
      </>
    ) : (
      <Button
        variant="secondary"
        onClick={() => setIsInstallModalOpen(false)}
        disabled={isInstalling || isCachingGitRepo}
      >
        {t('settings.skills.close')}
      </Button>
    )

  return (
    <>
      <div className="flex flex-col gap-6 min-w-0">
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] overflow-hidden">
          <div className="grid gap-4 px-5 py-5 min-w-0 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)] xl:items-end">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-tertiary)] mb-2">
                {t('settings.skills.browserEyebrow')}
              </div>
              <div className="flex items-center gap-3 mb-2">
                <span className="material-symbols-outlined text-[22px] text-[var(--color-brand)]">
                  auto_awesome
                </span>
                <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                  {t('settings.skills.browserTitle')}
                </h3>
              </div>
              <p className="text-sm leading-6 text-[var(--color-text-secondary)] max-w-3xl">
                {t('settings.skills.browserDescription')}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void fetchSkills(currentWorkDir)}
                >
                  <span className="material-symbols-outlined text-[16px]">refresh</span>
                  {t('settings.skills.refresh')}
                </Button>
                <Button size="sm" onClick={handleOpenInstallModal}>
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  {t('settings.skills.add')}
                </Button>
              </div>
              <div className="mt-4 max-w-2xl">
                <label className="sr-only" htmlFor="settings-skill-search">
                  {t('settings.skills.searchLabel')}
                </label>
                <div className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 transition-colors focus-within:border-[var(--color-border-focus)] focus-within:ring-2 focus-within:ring-[var(--color-brand)]/20">
                  <span className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)]">
                    search
                  </span>
                  <input
                    id="settings-skill-search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={t('settings.skills.searchPlaceholder')}
                    className="min-w-0 flex-1 bg-transparent text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      aria-label={t('settings.skills.clearSearch')}
                      onClick={() => setSearchQuery('')}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        close
                      </span>
                    </button>
                  )}
                </div>
                {normalizedSearchQuery && (
                  <p className="mt-2 text-[11px] text-[var(--color-text-tertiary)]">
                    {t('settings.skills.searchResultCount', {
                      count: String(filteredSkills.length),
                      total: String(skills.length),
                    })}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 min-w-0 sm:grid-cols-3">
              <SummaryCard
                label={t('settings.skills.summary.totalSkills')}
                value={String(filteredSkills.length)}
                icon="auto_awesome"
              />
              <SummaryCard
                label={t('settings.skills.summary.sources')}
                value={String(
                  SOURCE_ORDER.filter((source) => (grouped[source] ?? []).length > 0)
                    .length,
                )}
                icon="layers"
              />
              <SummaryCard
                label={t('settings.skills.summary.tokens')}
                value={t('settings.skills.tokenEstimateShort', {
                  count: String(totalTokens),
                })}
                icon="notes"
                className="col-span-2 sm:col-span-1"
              />
            </div>
          </div>
        </section>

        {skills.length === 0 && (
          <div className="text-center py-12 rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-6">
            <span className="material-symbols-outlined text-[40px] text-[var(--color-text-tertiary)] mb-2 block">
              auto_awesome
            </span>
            <p className="text-sm text-[var(--color-text-tertiary)]">
              {t('settings.skills.empty')}
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
              {t('settings.skills.emptyHint')}
            </p>
          </div>
        )}

        {skills.length > 0 && filteredSkills.length === 0 && (
          <div className="text-center py-12 rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-6">
            <span className="material-symbols-outlined text-[40px] text-[var(--color-text-tertiary)] mb-2 block">
              search_off
            </span>
            <p className="text-sm text-[var(--color-text-tertiary)]">
              {t('settings.skills.noSearchResults')}
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
              {t('settings.skills.noSearchResultsHint')}
            </p>
          </div>
        )}

        {filteredSkills.length > 0 && (
          <div
            className={`grid gap-4 ${
              visibleGroupCount >= 2 ? 'xl:grid-cols-2' : ''
            }`}
          >
            {SOURCE_ORDER.map((source) => {
              const group = grouped[source]
              if (!group?.length) return null

              const sourceLabel = t(`settings.skills.source.${source}`)
              const sourceTokenCount = group.reduce(
                (sum, skill) => sum + estimateTokens(skill.contentLength),
                0,
              )

              return (
                <section
                  key={source}
                  className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden min-w-0"
                >
                  <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${SOURCE_ACCENT_CLASSES[source]}`}
                        >
                          <span className="material-symbols-outlined text-[16px]">
                            {SOURCE_ICONS[source]}
                          </span>
                        </span>
                        <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
                          {sourceLabel}
                        </h4>
                        <span className="text-xs text-[var(--color-text-tertiary)]">
                          {group.length}
                        </span>
                      </div>
                      <p className="text-xs leading-5 text-[var(--color-text-tertiary)]">
                        {t('settings.skills.groupHint', {
                          source: sourceLabel,
                          count: String(group.length),
                        })}
                      </p>
                    </div>
                    <div className="text-[11px] text-[var(--color-text-tertiary)] whitespace-nowrap">
                      {t('settings.skills.tokenEstimateShort', {
                        count: String(sourceTokenCount),
                      })}
                    </div>
                  </div>

                  <div className="flex flex-col p-2">
                    {group.map((skill) => {
                      const installedSkillKey = `${skill.source}-${skill.name}`
                      const isInstalledSkillDescriptionExpanded =
                        expandedInstalledSkillDescriptions[installedSkillKey] ?? false

                      return (
                        <div
                          key={installedSkillKey}
                          role={skill.hasDirectory ? 'button' : undefined}
                          tabIndex={skill.hasDirectory ? 0 : undefined}
                          onClick={() =>
                            skill.hasDirectory &&
                            fetchSkillDetail(
                              skill.source,
                              skill.name,
                              currentWorkDir,
                              'skills',
                            )
                          }
                          onKeyDown={(event) => {
                            if (!skill.hasDirectory) return
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              void fetchSkillDetail(
                                skill.source,
                                skill.name,
                                currentWorkDir,
                                'skills',
                              )
                            }
                          }}
                          className={`group rounded-xl border border-transparent px-3 py-3 text-left transition-all ${
                            skill.hasDirectory
                              ? 'cursor-pointer hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]'
                              : 'opacity-60 cursor-default'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <span className="mt-0.5 material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)]">
                              auto_awesome
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-semibold text-[var(--color-text-primary)] break-all">
                                  {skill.displayName || skill.name}
                                </span>
                                {skill.version && (
                                  <span className="rounded-full bg-[var(--color-surface-container-high)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-tertiary)]">
                                    v{skill.version}
                                  </span>
                                )}
                                {skill.userInvocable && (
                                  <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-tertiary)]">
                                    {t('settings.skills.slashCommand')}
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 min-w-0 text-xs leading-5 text-[var(--color-text-secondary)]">
                                <p
                                  className={isInstalledSkillDescriptionExpanded
                                    ? 'break-words'
                                    : 'overflow-hidden text-ellipsis whitespace-nowrap'}
                                >
                                  {skill.description}
                                </p>
                                {skill.description.length > 100 && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      toggleInstalledSkillDescriptionExpanded(installedSkillKey)
                                    }}
                                    className="mt-1 text-xs font-medium text-[var(--color-brand)] transition-colors hover:opacity-80"
                                  >
                                    {isInstalledSkillDescriptionExpanded
                                      ? t('settings.skills.collapseDescription')
                                      : t('settings.skills.expandDescription')}
                                  </button>
                                )}
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-tertiary)]">
                                <span>{sourceLabel}</span>
                                <span>
                                  {t('settings.skills.tokenEstimateShort', {
                                    count: String(estimateTokens(skill.contentLength)),
                                  })}
                                </span>
                                <span>
                                  {skill.hasDirectory
                                    ? t('settings.skills.ready')
                                    : t('settings.skills.unavailable')}
                                </span>
                              </div>
                              {skill.canDelete && (
                                <div
                                  className="mt-3 flex flex-wrap gap-2"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    onClick={() => void handleDeleteSkill(skill)}
                                  >
                                    {t('settings.skills.delete')}
                                  </Button>
                                </div>
                              )}
                            </div>
                            <span className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)] opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100">
                              chevron_right
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>

      <Modal
        open={isInstallModalOpen}
        onClose={() => {
          if (!isInstalling && !isCachingGitRepo) {
            setIsInstallModalOpen(false)
          }
        }}
        title={t('settings.skills.installTitle')}
        width={1040}
        footer={installModalFooter}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
            {t('settings.skills.installDescription')}
          </p>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
              {t('settings.skills.installSourceLabel')}
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
                <input
                  type="radio"
                  name="skill-install-source"
                  checked={installMode === 'directory'}
                  onChange={() => setInstallMode('directory')}
                  className="mt-1"
                />
                <div>
                  <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {t('settings.skills.installSourceDirectory')}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
                    {t('settings.skills.installSourceDirectoryHint')}
                  </div>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
                <input
                  type="radio"
                  name="skill-install-source"
                  checked={installMode === 'git'}
                  onChange={() => setInstallMode('git')}
                  className="mt-1"
                />
                <div>
                  <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {t('settings.skills.installSourceGit')}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
                    {t('settings.skills.installSourceGitHint')}
                  </div>
                </div>
              </label>
            </div>
          </fieldset>

          {installMode === 'directory' ? (
            <div className="flex flex-col gap-4">
              <div>
                <label
                  htmlFor="settings-skill-install-path"
                  className="mb-2 block text-sm font-medium text-[var(--color-text-primary)]"
                >
                  {t('settings.skills.installPathLabel')}
                </label>
                <div className="flex gap-2">
                  <input
                    id="settings-skill-install-path"
                    value={installPath}
                    onChange={(event) => setInstallPath(event.target.value)}
                    placeholder={t('settings.skills.installPathPlaceholder')}
                    className="min-w-0 flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)] focus:ring-2 focus:ring-[var(--color-brand)]/20"
                  />
                  {isTauriRuntime() && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void handleBrowseInstallPath()}
                    >
                      {t('settings.skills.installBrowse')}
                    </Button>
                  )}
                </div>
                <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">
                  {t('settings.skills.installHint')}
                </p>
              </div>

              <fieldset>
                <legend className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
                  {t('settings.skills.installScopeLabel')}
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
                    <input
                      type="radio"
                      name="skill-install-scope"
                      checked={installScope === 'user'}
                      onChange={() => setInstallScope('user')}
                      className="mt-1"
                    />
                    <div>
                      <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                        {t('settings.skills.installScopeUser')}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
                        ~/.cc-tools/skills
                      </div>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
                      currentWorkDir
                        ? 'cursor-pointer border-[var(--color-border)] bg-[var(--color-surface)]'
                        : 'cursor-not-allowed border-[var(--color-border)] bg-[var(--color-surface-container-low)] opacity-60'
                    }`}
                  >
                    <input
                      type="radio"
                      name="skill-install-scope"
                      checked={installScope === 'project'}
                      onChange={() => setInstallScope('project')}
                      disabled={!currentWorkDir}
                      className="mt-1"
                    />
                    <div>
                      <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                        {t('settings.skills.installScopeProject')}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)] break-all">
                        {currentWorkDir
                          ? t('settings.skills.installCurrentProject', {
                              path: currentWorkDir,
                            })
                          : t('settings.skills.installNoProject')}
                      </div>
                    </div>
                  </label>
                </div>
              </fieldset>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px] md:items-end">
                <div className="grid gap-4">
                  <div>
                    <label
                      htmlFor="settings-skill-install-repo-url"
                      className="mb-2 block text-sm font-medium text-[var(--color-text-primary)]"
                    >
                      {t('settings.skills.gitRepoUrlLabel')}
                    </label>
                    <input
                      id="settings-skill-install-repo-url"
                      value={repoUrl}
                      onChange={(event) => setRepoUrl(event.target.value)}
                      placeholder={t('settings.skills.gitRepoUrlPlaceholder')}
                      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)] focus:ring-2 focus:ring-[var(--color-brand)]/20"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="settings-skill-install-repo-ref"
                      className="mb-2 block text-sm font-medium text-[var(--color-text-primary)]"
                    >
                      {t('settings.skills.gitRepoRefLabel')}
                    </label>
                    <input
                      id="settings-skill-install-repo-ref"
                      value={repoRef}
                      onChange={(event) => setRepoRef(event.target.value)}
                      placeholder={t('settings.skills.gitRepoRefPlaceholder')}
                      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)] focus:ring-2 focus:ring-[var(--color-brand)]/20"
                    />
                  </div>
                </div>

                <Button
                  type="button"
                  onClick={() => void handleCacheGitRepo()}
                  loading={isCachingGitRepo}
                >
                  {t('settings.skills.cacheGitRepo')}
                </Button>
              </div>

              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] overflow-hidden min-w-0">
                <div className="px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
                  <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {t('settings.skills.cachedGitReposTitle')}
                  </h4>
                  <p className="mt-1 text-xs text-[var(--color-text-tertiary)] leading-5">
                    {t('settings.skills.cachedGitReposHint')}
                  </p>
                </div>

                {isLoadingCachedGitRepos ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin w-5 h-5 border-2 border-[var(--color-brand)] border-t-transparent rounded-full" />
                  </div>
                ) : cachedGitRepos.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-[var(--color-text-tertiary)]">
                    {t('settings.skills.cachedGitReposEmpty')}
                  </div>
                ) : (
                  <div className="flex flex-col divide-y divide-[var(--color-border)]">
                    {cachedGitRepos.map((repo) => {
                      const isExpanded = expandedRepoIds[repo.id] ?? true

                      return (
                        <div key={repo.id} className="px-4 py-4">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <button
                              type="button"
                              onClick={() => toggleCachedRepoExpanded(repo.id)}
                              className="min-w-0 flex flex-1 items-start gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
                            >
                              <span className="material-symbols-outlined mt-0.5 text-[18px] text-[var(--color-text-tertiary)]">
                                {isExpanded ? 'expand_more' : 'chevron_right'}
                              </span>
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-[var(--color-text-primary)] break-all">
                                  {repo.repoUrl}
                                </div>
                                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-text-tertiary)]">
                                  {repo.ref && <span>{t('settings.skills.cachedRepoRef', { ref: repo.ref })}</span>}
                                  <span>{t('settings.skills.cachedRepoSkillCount', { count: String(repo.skills.length) })}</span>
                                </div>
                              </div>
                            </button>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() =>
                                  void handleInstallAllCachedGitSkills(repo, 'user')
                                }
                                disabled={repo.skills.length === 0 || isInstalling}
                              >
                                {t('settings.skills.installAllGlobal')}
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() =>
                                  void handleInstallAllCachedGitSkills(repo, 'project')
                                }
                                disabled={repo.skills.length === 0 || !currentWorkDir || isInstalling}
                              >
                                {t('settings.skills.installAllProject')}
                              </Button>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="mt-4 grid gap-4 2xl:grid-cols-2">
                              {repo.skills.map((skill) => {
                                const skillKey = `${repo.id}-${skill.skillPath ?? skill.name}`
                                const isDescriptionExpanded = expandedSkillDescriptions[skillKey] ?? false

                                return (
                                  <div
                                    key={skillKey}
                                    className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4"
                                  >
                                    <div className="flex items-start justify-between gap-4">
                                      <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="text-sm font-semibold text-[var(--color-text-primary)] break-all">
                                            {skill.displayName || skill.name}
                                          </span>
                                          {skill.version && (
                                            <span className="rounded-full bg-[var(--color-surface-container-high)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-tertiary)]">
                                              v{skill.version}
                                            </span>
                                          )}
                                          {skill.installedInUser && (
                                            <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-tertiary)]">
                                              {t('settings.skills.installedGlobal')}
                                            </span>
                                          )}
                                          {skill.installedInProject && (
                                            <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-tertiary)]">
                                              {t('settings.skills.installedProject')}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex shrink-0 items-center gap-2">
                                        <Button
                                          variant="secondary"
                                          size="sm"
                                          onClick={() =>
                                            void handleInstallCachedGitSkill(repo, skill, 'user')
                                          }
                                          disabled={isInstalling}
                                        >
                                          {t('settings.skills.installToGlobal')}
                                        </Button>
                                        <Button
                                          variant="secondary"
                                          size="sm"
                                          onClick={() =>
                                            void handleInstallCachedGitSkill(repo, skill, 'project')
                                          }
                                          disabled={!currentWorkDir || isInstalling}
                                        >
                                          {t('settings.skills.installToProject')}
                                        </Button>
                                      </div>
                                    </div>
                                    <div className="mt-2 min-w-0 text-sm leading-6 text-[var(--color-text-secondary)]">
                                      <p
                                        className={isDescriptionExpanded
                                          ? 'break-words'
                                          : 'overflow-hidden text-ellipsis whitespace-nowrap'}
                                      >
                                        {skill.description}
                                      </p>
                                      {skill.description.length > 100 && (
                                        <button
                                          type="button"
                                          onClick={() => toggleSkillDescriptionExpanded(skillKey)}
                                          className="mt-1 text-xs font-medium text-[var(--color-brand)] transition-colors hover:opacity-80"
                                        >
                                          {isDescriptionExpanded
                                            ? t('settings.skills.collapseDescription')
                                            : t('settings.skills.expandDescription')}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}

function installScopeNeedsProject(
  scope: InstallScope,
  currentWorkDir: string | undefined,
): boolean {
  return scope === 'project' && !currentWorkDir
}

function SummaryCard({
  label,
  value,
  icon,
  className = '',
}: {
  label: string
  value: string
  icon: string
  className?: string
}) {
  return (
    <div
      className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 min-w-0 ${className}`}
    >
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] min-w-0">
        <span className="material-symbols-outlined text-[14px] flex-shrink-0">
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 text-lg font-semibold text-[var(--color-text-primary)] truncate">
        {value}
      </div>
    </div>
  )
}
