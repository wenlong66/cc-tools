import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

import { skillsApi } from '../api/skills'
import { Settings } from '../pages/Settings'
import { useSkillStore } from '../stores/skillStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useSessionStore } from '../stores/sessionStore'
import { useTabStore, SETTINGS_TAB_ID } from '../stores/tabStore'
import { useUIStore } from '../stores/uiStore'
import { useOpenTargetStore } from '../stores/openTargetStore'

vi.mock('../api/agents', () => ({
  agentsApi: {
    list: vi.fn().mockResolvedValue({ activeAgents: [], allAgents: [] }),
  },
}))

vi.mock('../api/skills', () => ({
  skillsApi: {
    install: vi.fn(),
    listCachedGitRepos: vi.fn(),
    addCachedGitRepo: vi.fn(),
    remove: vi.fn(),
  },
}))

vi.mock('../stores/providerStore', () => ({
  useProviderStore: () => ({
    providers: [],
    activeId: null,
    presets: [],
    isLoading: false,
    isPresetsLoading: false,
    fetchProviders: vi.fn(),
    fetchPresets: vi.fn(),
    deleteProvider: vi.fn(),
    activateProvider: vi.fn(),
    activateOfficial: vi.fn(),
    testProvider: vi.fn(),
    createProvider: vi.fn(),
    updateProvider: vi.fn(),
    testConfig: vi.fn(),
  }),
}))

vi.mock('../stores/openTargetStore', () => ({
  useOpenTargetStore: vi.fn(),
}))

vi.mock('../pages/AdapterSettings', () => ({
  AdapterSettings: () => <div>Adapter Settings Mock</div>,
}))

vi.mock('../stores/agentStore', () => ({
  useAgentStore: () => ({
    activeAgents: [],
    allAgents: [],
    isLoading: false,
    error: null,
    selectedAgent: null,
    fetchAgents: vi.fn(),
    selectAgent: vi.fn(),
  }),
}))

vi.mock('../components/chat/CodeViewer', () => ({
  CodeViewer: ({ code }: { code: string }) => <pre data-testid="code-viewer">{code}</pre>,
}))

const MOCK_FETCH_SKILLS = vi.fn()
const MOCK_FETCH_SKILL_DETAIL = vi.fn()
const MOCK_CLEAR_SELECTION = vi.fn()
const MOCK_ENSURE_OPEN_TARGETS = vi.fn().mockResolvedValue(undefined)
const MOCK_OPEN_TARGET = vi.fn().mockResolvedValue(undefined)
const MOCK_INSTALL_SKILL = vi.mocked(skillsApi.install)
const MOCK_LIST_CACHED_GIT_REPOS = vi.mocked(skillsApi.listCachedGitRepos)
const MOCK_ADD_CACHED_GIT_REPO = vi.mocked(skillsApi.addCachedGitRepo)
const MOCK_REMOVE_SKILL = vi.mocked(skillsApi.remove)

function switchToSkillsTab() {
  fireEvent.click(screen.getByText('Skills'))
}

describe('Settings > Skills tab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useOpenTargetStore).mockImplementation((selector: any) => selector({
      targets: [{ id: 'finder', kind: 'file_manager', label: 'Finder', icon: 'finder', platform: 'darwin' }],
      ensureTargets: MOCK_ENSURE_OPEN_TARGETS,
      openTarget: MOCK_OPEN_TARGET,
    }))
    MOCK_FETCH_SKILLS.mockResolvedValue(undefined)
    MOCK_FETCH_SKILL_DETAIL.mockResolvedValue(undefined)
    MOCK_INSTALL_SKILL.mockResolvedValue({
      ok: true,
      message: 'Installed alpha to project skills',
      skill: {
        name: 'alpha',
        description: 'Installed skill',
        source: 'project',
        userInvocable: true,
        contentLength: 120,
        hasDirectory: true,
      },
    })
    MOCK_LIST_CACHED_GIT_REPOS.mockResolvedValue({
      records: [
        {
          id: 'repo-1',
          repoUrl: 'https://github.com/example/skills.git',
          ref: 'main',
          cacheDir: '/cache/repo-1',
          addedAt: '2026-06-11T00:00:00.000Z',
          skills: [
            {
              name: 'release-helper',
              description: 'Release helper skill',
              skillPath: 'skills/release-helper',
              installedInUser: false,
              installedInProject: false,
            },
          ],
        },
      ],
    })
    MOCK_ADD_CACHED_GIT_REPO.mockResolvedValue({
      ok: true,
      message: 'Cached https://github.com/example/skills.git',
      record: {
        id: 'repo-1',
        repoUrl: 'https://github.com/example/skills.git',
        ref: 'main',
        cacheDir: '/cache/repo-1',
        addedAt: '2026-06-11T00:00:00.000Z',
        skills: [
          {
            name: 'release-helper',
            description: 'Release helper skill',
            skillPath: 'skills/release-helper',
            installedInUser: false,
            installedInProject: false,
          },
        ],
      },
    })
    MOCK_REMOVE_SKILL.mockResolvedValue({
      ok: true,
      message: 'Deleted alpha from user skills',
    })
    useSettingsStore.setState({ locale: 'en' })
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-1',
          title: 'Active session',
          createdAt: '2026-04-20T00:00:00.000Z',
          modifiedAt: '2026-04-20T00:00:00.000Z',
          messageCount: 1,
          projectPath: '/workspace/project',
          workDir: '/workspace/project',
          workDirExists: true,
        },
      ],
      activeSessionId: 'session-1',
      isLoading: false,
      error: null,
    })
    useTabStore.setState({ tabs: [], activeTabId: null })
    useUIStore.setState({ pendingSettingsTab: null })
    useSkillStore.setState({
      skills: [],
      roots: {
        user: '/home/test/.cc-tools/skills',
        project: '/workspace/project/.cc-tools/skills',
      },
      selectedSkill: null,
      selectedSkillReturnTab: 'skills',
      isLoading: false,
      isDetailLoading: false,
      error: null,
      fetchSkills: MOCK_FETCH_SKILLS,
      fetchSkillDetail: MOCK_FETCH_SKILL_DETAIL,
      clearSelection: MOCK_CLEAR_SELECTION,
    })
  })

  it('renders browser summary, grouped skill cards, and scope directories', async () => {
    useSkillStore.setState({
      skills: [
        {
          name: 'alpha',
          displayName: 'Alpha Skill',
          description: 'First skill description',
          source: 'user',
          userInvocable: true,
          version: '1.0.0',
          contentLength: 400,
          hasDirectory: true,
        },
        {
          name: 'beta',
          description: 'Second skill description',
          source: 'project',
          userInvocable: false,
          contentLength: 200,
          hasDirectory: true,
        },
        {
          name: 'telegram:access',
          displayName: 'Telegram Access',
          description: 'Plugin-provided access workflow',
          source: 'plugin',
          pluginName: 'telegram',
          userInvocable: true,
          contentLength: 280,
          hasDirectory: true,
        },
      ],
    })

    render(<Settings />)
    switchToSkillsTab()

    expect(screen.getByText('Browse installed skills')).toBeInTheDocument()
    expect(screen.getByText('Skill Browser')).toBeInTheDocument()
    expect(screen.getByText('Total skills')).toBeInTheDocument()
    expect(screen.getByText('Alpha Skill')).toBeInTheDocument()
    expect(screen.getByText('Second skill description')).toBeInTheDocument()
    expect(screen.getAllByText('Plugin').length).toBeGreaterThan(0)
    expect(screen.getByText('Telegram Access')).toBeInTheDocument()
    expect(screen.getByText('/home/test/.cc-tools/skills')).toBeInTheDocument()
    expect(screen.getByText('/workspace/project/.cc-tools/skills')).toBeInTheDocument()

    const openDirectoryButtons = screen.getAllByText('Open directory')
    const userOpenDirectoryButton = openDirectoryButtons[0]
    if (!userOpenDirectoryButton) throw new Error('Missing user open directory button')
    await act(async () => {
      fireEvent.click(userOpenDirectoryButton)
      await Promise.resolve()
    })

    expect(MOCK_OPEN_TARGET).toHaveBeenCalledWith('finder', '/home/test/.cc-tools/skills')
  })

  it('filters installed skills locally by keyword and clears the search', () => {
    useSkillStore.setState({
      skills: [
        {
          name: 'alpha',
          displayName: 'Alpha Skill',
          description: 'First skill description',
          source: 'user',
          userInvocable: true,
          contentLength: 400,
          hasDirectory: true,
        },
        {
          name: 'telegram:access',
          displayName: 'Telegram Access',
          description: 'Plugin-provided access workflow',
          source: 'plugin',
          pluginName: 'telegram',
          userInvocable: true,
          contentLength: 280,
          hasDirectory: true,
        },
      ],
    })

    render(<Settings />)
    switchToSkillsTab()

    const searchInput = screen.getByPlaceholderText('Search skills by name, description, or source...')
    fireEvent.change(searchInput, { target: { value: 'telegram' } })

    expect(screen.getByText('Telegram Access')).toBeInTheDocument()
    expect(screen.queryByText('Alpha Skill')).not.toBeInTheDocument()
    expect(screen.getByText('1 of 2 skills match')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Clear skill search'))

    expect(screen.getByText('Telegram Access')).toBeInTheDocument()
    expect(screen.getByText('Alpha Skill')).toBeInTheDocument()
  })

  it('uses the active session workDir even when settings tab is focused', () => {
    const fetchSkills = vi.fn()
    useSkillStore.setState({
      skills: [],
      selectedSkill: null,
      isLoading: false,
      isDetailLoading: false,
      error: null,
      fetchSkills,
      fetchSkillDetail: MOCK_FETCH_SKILL_DETAIL,
      clearSelection: MOCK_CLEAR_SELECTION,
    })
    useTabStore.setState({
      activeTabId: SETTINGS_TAB_ID,
      tabs: [{ sessionId: SETTINGS_TAB_ID, title: 'Settings', type: 'settings', status: 'idle' }],
    })

    render(<Settings />)
    switchToSkillsTab()

    expect(fetchSkills).toHaveBeenCalledWith('/workspace/project')
  })

  it('opens skill detail with metadata cards and parsed markdown body', () => {
    useSkillStore.setState({
      selectedSkill: {
        meta: {
          name: 'alpha',
          displayName: 'Alpha Skill',
          description: 'First skill description',
          source: 'user',
          userInvocable: true,
          version: '1.0.0',
          contentLength: 400,
          hasDirectory: true,
        },
        tree: [
          { name: 'SKILL.md', path: 'SKILL.md', type: 'file' },
          { name: 'run.ts', path: 'run.ts', type: 'file' },
        ],
        files: [
          {
            path: 'SKILL.md',
            content: '# Hello\n\nBody content',
            body: '# Hello\n\nBody content',
            language: 'markdown',
            isEntry: true,
            frontmatter: {
              description: 'Frontmatter description',
              'allowed-tools': ['Read', 'Edit'],
              model: 'sonnet',
            },
          },
          {
            path: 'run.ts',
            content: 'console.log("hello")',
            language: 'typescript',
            isEntry: false,
          },
        ],
        skillRoot: '/tmp/alpha',
      },
      selectedSkillReturnTab: 'skills',
    })

    render(<Settings />)
    switchToSkillsTab()

    expect(screen.getByText('Skill metadata')).toBeInTheDocument()
    expect(screen.getByText('/slash')).toBeInTheDocument()
    expect(screen.getByText('Frontmatter description')).toBeInTheDocument()
    expect(screen.getByText('Read, Edit')).toBeInTheDocument()
    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(screen.queryByText(/^---$/)).not.toBeInTheDocument()
  })

  it('installs a local skill into the selected scope from the skills manager modal', async () => {
    render(<Settings />)
    switchToSkillsTab()

    await act(async () => {
      fireEvent.click(screen.getByText('Add skill'))
      await Promise.resolve()
    })

    fireEvent.change(screen.getByLabelText('Skill directory'), {
      target: { value: '/imports/alpha-skill' },
    })
    fireEvent.click(screen.getByText('Install into the current project: /workspace/project'))

    await act(async () => {
      fireEvent.click(screen.getByText('Install skill'))
      await Promise.resolve()
    })

    expect(MOCK_INSTALL_SKILL).toHaveBeenCalledWith({
      mode: 'directory',
      path: '/imports/alpha-skill',
      scope: 'project',
      cwd: '/workspace/project',
    })
    expect(MOCK_FETCH_SKILLS).toHaveBeenLastCalledWith('/workspace/project')
  })

  it('caches a git repository and installs a selected cached skill', async () => {
    render(<Settings />)
    switchToSkillsTab()

    await act(async () => {
      fireEvent.click(screen.getByText('Add skill'))
      await Promise.resolve()
    })

    fireEvent.click(screen.getByText('Git repository'))
    fireEvent.change(screen.getByLabelText('Repository URL'), {
      target: { value: 'https://github.com/example/skills.git' },
    })
    fireEvent.change(screen.getByLabelText('Ref (optional)'), {
      target: { value: 'main' },
    })

    await act(async () => {
      fireEvent.click(screen.getByText('Add to cache'))
      await Promise.resolve()
    })

    expect(MOCK_ADD_CACHED_GIT_REPO).toHaveBeenCalledWith({
      repoUrl: 'https://github.com/example/skills.git',
      ref: 'main',
      cwd: '/workspace/project',
    })

    await act(async () => {
      fireEvent.click(screen.getByText('Add to global'))
      await Promise.resolve()
    })

    expect(MOCK_INSTALL_SKILL).toHaveBeenCalledWith({
      mode: 'git',
      repoUrl: 'https://github.com/example/skills.git',
      ref: 'main',
      skillPath: 'skills/release-helper',
      scope: 'user',
      cwd: '/workspace/project',
    })
  })

  it('refreshes a cached git repository from the repository actions', async () => {
    render(<Settings />)
    switchToSkillsTab()

    await act(async () => {
      fireEvent.click(screen.getByText('Add skill'))
      await Promise.resolve()
    })

    await act(async () => {
      fireEvent.click(screen.getByText('Git repository'))
      await Promise.resolve()
    })

    const refreshButtons = await screen.findAllByText('Refresh')
    const repoRefreshButton = refreshButtons[refreshButtons.length - 1]
    if (!repoRefreshButton) throw new Error('Missing cached repository refresh button')

    await act(async () => {
      fireEvent.click(repoRefreshButton)
      await Promise.resolve()
    })

    expect(MOCK_ADD_CACHED_GIT_REPO).toHaveBeenCalledWith({
      repoUrl: 'https://github.com/example/skills.git',
      ref: 'main',
      cwd: '/workspace/project',
    })
  })

  it('deletes a managed user skill from the list', async () => {
    useSkillStore.setState({
      skills: [
        {
          name: 'alpha',
          displayName: 'Alpha Skill',
          description: 'First skill description',
          source: 'user',
          userInvocable: true,
          contentLength: 400,
          hasDirectory: true,
          canDelete: true,
        },
      ],
    })

    render(<Settings />)
    switchToSkillsTab()

    await act(async () => {
      fireEvent.click(screen.getByText('Delete'))
      await Promise.resolve()
    })

    expect(MOCK_REMOVE_SKILL).toHaveBeenCalledWith(
      'user',
      'alpha',
      '/workspace/project',
    )
  })

  it('returns to plugins tab when skill detail was opened from plugins', async () => {
    useSkillStore.setState({
      selectedSkill: {
        meta: {
          name: 'telegram:access',
          displayName: 'Access',
          description: 'Plugin skill',
          source: 'plugin',
          userInvocable: true,
          contentLength: 200,
          hasDirectory: true,
        },
        tree: [{ name: 'SKILL.md', path: 'SKILL.md', type: 'file' }],
        files: [
          {
            path: 'SKILL.md',
            content: '# Access',
            body: '# Access',
            language: 'markdown',
            isEntry: true,
          },
        ],
        skillRoot: '/tmp/telegram-access',
      },
      selectedSkillReturnTab: 'plugins',
    })

    render(<Settings />)
    switchToSkillsTab()

    await act(async () => {
      fireEvent.click(screen.getByText('Back to list'))
      await Promise.resolve()
    })

    expect(screen.getByText('Installed Plugins')).toBeInTheDocument()
  })
})
