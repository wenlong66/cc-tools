import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { act } from 'react'

const viewportMocks = vi.hoisted(() => ({
  isMobile: false,
}))

vi.mock('../hooks/useMobileViewport', () => ({
  useMobileViewport: () => viewportMocks.isMobile,
}))

vi.mock('../components/chat/MessageList', () => ({
  MessageList: ({ compact }: { compact?: boolean }) => (
    <div data-testid="message-list" data-compact={compact ? 'true' : 'false'} />
  ),
}))

vi.mock('../components/chat/ChatInput', () => ({
  ChatInput: ({ compact, variant }: { compact?: boolean; variant?: string }) => (
    <div data-testid="chat-input" data-compact={compact ? 'true' : 'false'} data-variant={variant} />
  ),
}))

vi.mock('../components/teams/TeamStatusBar', () => ({
  TeamStatusBar: () => <div data-testid="team-status-bar" />,
}))

vi.mock('../components/chat/SessionTaskBar', () => ({
  SessionTaskBar: () => <div data-testid="session-task-bar" />,
}))

vi.mock('../components/workspace/WorkspacePanel', () => ({
  WorkspacePanel: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="workspace-panel">workspace:{sessionId}</div>
  ),
}))

vi.mock('./TerminalSettings', () => ({
  TerminalSettings: ({
    cwd,
    onOpenInTab,
    onClose,
    testId,
  }: {
    cwd?: string
    onOpenInTab?: () => void
    onClose?: () => void
    testId: string
  }) => (
    <div data-testid={testId} data-cwd={cwd ?? ''}>
      <button type="button" onClick={onOpenInTab}>Open in Tab</button>
      <button type="button" onClick={onClose}>Close terminal panel</button>
    </div>
  ),
}))

vi.mock('../components/chat/ComputerUsePermissionModal', () => ({
  ComputerUsePermissionModal: () => <div data-testid="computer-use-permission-modal" />,
}))

import { ActiveSession } from './ActiveSession'
import { useChatStore } from '../stores/chatStore'
import { useCLITaskStore } from '../stores/cliTaskStore'
import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'
import { useTeamStore } from '../stores/teamStore'
import { useWorkspacePanelStore } from '../stores/workspacePanelStore'
import { WORKSPACE_PANEL_DEFAULT_WIDTH } from '../stores/workspacePanelStore'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  viewportMocks.isMobile = false
  useTabStore.setState({ tabs: [], activeTabId: null })
  useSessionStore.setState({ sessions: [], activeSessionId: null, isLoading: false, error: null })
  useChatStore.setState({ sessions: {} })
  useTeamStore.setState({ teams: [], activeTeam: null, memberColors: new Map(), error: null })
  useWorkspacePanelStore.setState(useWorkspacePanelStore.getInitialState(), true)
})

describe('ActiveSession task polling', () => {
  it('treats a persisted historical session as non-empty before messages finish loading', () => {
    const sessionId = 'history-loading-session'

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'History Loading Session',
        createdAt: '2026-05-07T00:00:00.000Z',
        modifiedAt: '2026-05-07T00:00:00.000Z',
        messageCount: 2,
        projectPath: '/workspace/project',
        workDir: '/workspace/project',
        workDirExists: true,
      }],
      activeSessionId: sessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId, title: 'History Loading Session', type: 'session', status: 'idle' }],
      activeTabId: sessionId,
    })
    useChatStore.setState({
      sessions: {
        [sessionId]: {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    render(<ActiveSession />)

    expect(screen.getByTestId('message-list')).toBeInTheDocument()
    expect(screen.getByTestId('chat-input')).toHaveAttribute('data-variant', 'default')
  })

  it('refreshes CLI tasks repeatedly while a turn is active', async () => {
    vi.useFakeTimers()

    const sessionId = 'polling-session'
    const originalCliTaskState = useCLITaskStore.getState()
    const fetchSessionTasks = vi.fn().mockResolvedValue(undefined)

    useCLITaskStore.setState({
      sessionId,
      tasks: [],
      fetchSessionTasks,
    })

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Polling Session',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 1,
        projectPath: '',
        workDir: null,
        workDirExists: true,
      }],
      activeSessionId: sessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId, title: 'Polling Session', type: 'session', status: 'idle' }],
      activeTabId: sessionId,
    })
    useChatStore.setState({
      sessions: {
        [sessionId]: {
          messages: [],
          chatState: 'thinking',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    const { unmount } = render(<ActiveSession />)

    expect(fetchSessionTasks).toHaveBeenCalledWith(sessionId)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2200)
    })

    expect(
      fetchSessionTasks.mock.calls.filter(([currentSessionId]) => currentSessionId === sessionId),
    ).toHaveLength(4)

    unmount()
    useCLITaskStore.setState(originalCliTaskState)
  })

  it('keeps member sessions interactive and skips leader task polling', () => {
    const memberSessionId = 'team-member:security-reviewer@test-team'
    const originalCliTaskState = useCLITaskStore.getState()
    const fetchSessionTasks = vi.fn().mockResolvedValue(undefined)

    useCLITaskStore.setState({
      sessionId: null,
      tasks: [],
      fetchSessionTasks,
    })

    useTeamStore.setState({
      teams: [],
      activeTeam: {
        name: 'test-team',
        leadAgentId: 'team-lead@test-team',
        leadSessionId: 'leader-session',
        members: [
          {
            agentId: 'team-lead@test-team',
            role: 'team-lead',
            status: 'running',
            sessionId: 'leader-session',
          },
          {
            agentId: 'security-reviewer@test-team',
            role: 'security-reviewer',
            status: 'running',
          },
        ],
      },
      memberColors: new Map(),
      error: null,
    })

    useTabStore.setState({
      tabs: [{ sessionId: memberSessionId, title: 'security-reviewer', type: 'session', status: 'idle' }],
      activeTabId: memberSessionId,
    })

    useChatStore.setState({
      sessions: {
        [memberSessionId]: {
          messages: [],
          chatState: 'thinking',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    const { queryByTestId, unmount } = render(<ActiveSession />)

    expect(queryByTestId('chat-input')).toBeInTheDocument()
    expect(queryByTestId('session-task-bar')).not.toBeInTheDocument()
    expect(fetchSessionTasks).not.toHaveBeenCalled()

    unmount()
    useCLITaskStore.setState(originalCliTaskState)
  })

  it('renders the workspace panel to the right of chat and supports resizing', () => {
    const sessionId = 'workspace-session'

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Workspace Session',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 1,
        projectPath: '',
        workDir: '/tmp/project',
        workDirExists: true,
      }],
      activeSessionId: sessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId, title: 'Workspace Session', type: 'session', status: 'idle' }],
      activeTabId: sessionId,
    })
    useChatStore.setState({
      sessions: {
        [sessionId]: {
          messages: [{ id: 'msg-1', type: 'assistant_text', content: 'hello', timestamp: 1 }],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })
    useWorkspacePanelStore.getState().openPanel(sessionId)

    render(<ActiveSession />)

    const contentRow = screen.getByTestId('active-session-content-row')
    const chatColumn = screen.getByTestId('active-session-chat-column')
    const resizeHandle = screen.getByTestId('workspace-resize-handle')

    expect(within(contentRow).getByTestId('message-list')).toBeInTheDocument()
    expect(within(contentRow).getByTestId('message-list')).toHaveAttribute('data-compact', 'true')
    expect(within(contentRow).getByTestId('workspace-panel')).toHaveTextContent(`workspace:${sessionId}`)
    expect(within(chatColumn).getByTestId('chat-input')).toBeInTheDocument()
    expect(within(chatColumn).getByTestId('chat-input')).toHaveAttribute('data-compact', 'true')
    expect(chatColumn).toHaveClass('flex-1')
    expect(chatColumn).not.toHaveClass('shrink-0')
    expect(contentRow.children[0]).toBe(chatColumn)
    expect(contentRow.children[1]).toBe(resizeHandle)
    expect(contentRow.children[2]).toBe(screen.getByTestId('workspace-panel'))

    act(() => {
      fireEvent.keyDown(resizeHandle, { key: 'ArrowLeft' })
    })

    expect(useWorkspacePanelStore.getState().width).toBe(WORKSPACE_PANEL_DEFAULT_WIDTH + 32)
  })

  it('does not render the workspace panel when closed or for member sessions', () => {
    const regularSessionId = 'regular-session'

    useSessionStore.setState({
      sessions: [{
        id: regularSessionId,
        title: 'Regular Session',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 0,
        projectPath: '',
        workDir: '/tmp/project',
        workDirExists: true,
      }],
      activeSessionId: regularSessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId: regularSessionId, title: 'Regular Session', type: 'session', status: 'idle' }],
      activeTabId: regularSessionId,
    })
    useChatStore.setState({
      sessions: {
        [regularSessionId]: {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    const { rerender } = render(<ActiveSession />)
    expect(screen.queryByTestId('workspace-panel')).not.toBeInTheDocument()

    const memberSessionId = 'team-member:security-reviewer@test-team'
    act(() => {
      useTeamStore.setState({
        teams: [],
        activeTeam: {
          name: 'test-team',
          leadAgentId: 'team-lead@test-team',
          leadSessionId: 'leader-session',
          members: [
            {
              agentId: 'team-lead@test-team',
              role: 'team-lead',
              status: 'running',
              sessionId: 'leader-session',
            },
            {
              agentId: 'security-reviewer@test-team',
              role: 'security-reviewer',
              status: 'running',
            },
          ],
        },
        memberColors: new Map(),
        error: null,
      })
      useTabStore.setState({
        tabs: [{ sessionId: memberSessionId, title: 'security-reviewer', type: 'session', status: 'idle' }],
        activeTabId: memberSessionId,
      })
      useChatStore.setState({
        sessions: {
          [memberSessionId]: {
            messages: [{ id: 'msg-2', type: 'assistant_text', content: 'hello', timestamp: 1 }],
            chatState: 'idle',
            connectionState: 'connected',
            streamingText: '',
            streamingToolInput: '',
            activeToolUseId: null,
            activeToolName: null,
            activeThinkingId: null,
            pendingPermission: null,
            pendingComputerUsePermission: null,
            tokenUsage: { input_tokens: 0, output_tokens: 0 },
            elapsedSeconds: 0,
            statusVerb: '',
            slashCommands: [],
            agentTaskNotifications: {},
            elapsedTimer: null,
          },
        },
      })
      useWorkspacePanelStore.getState().openPanel(memberSessionId)
      rerender(<ActiveSession />)
    })

    expect(screen.queryByTestId('workspace-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('message-list')).toBeInTheDocument()
  })

  it('keeps chat as the primary surface on mobile by hiding workspace and terminal panels', () => {
    const sessionId = 'mobile-session'
    viewportMocks.isMobile = true

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Mobile Session',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 1,
        projectPath: '/tmp/project-root',
        workDir: '/tmp/project-root',
        workDirExists: true,
      }],
      activeSessionId: sessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId, title: 'Mobile Session', type: 'session', status: 'idle' }],
      activeTabId: sessionId,
    })
    useChatStore.setState({
      sessions: {
        [sessionId]: {
          messages: [{ id: 'msg-1', type: 'assistant_text', content: 'hello', timestamp: 1 }],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })
    useWorkspacePanelStore.getState().openPanel(sessionId)

    render(<ActiveSession />)

    expect(screen.getByTestId('active-session-chat-column')).toHaveClass('min-w-0')
    expect(screen.getByTestId('message-list')).toHaveAttribute('data-compact', 'false')
    expect(screen.getByTestId('chat-input')).toHaveAttribute('data-compact', 'false')
    expect(screen.queryByRole('heading', { name: 'Mobile Session' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('workspace-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('workspace-resize-handle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('session-terminal-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('terminal-resize-handle')).not.toBeInTheDocument()
  })

  it('does not render a bottom terminal panel for a normal web session', () => {
    const sessionId = 'terminal-session'

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Terminal Session',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 1,
        projectPath: '/tmp/project-root',
        workDir: '/tmp/project-root/packages/app',
        workDirExists: true,
      }],
      activeSessionId: sessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId, title: 'Terminal Session', status: 'idle' } as ReturnType<typeof useTabStore.getState>['tabs'][number]],
      activeTabId: sessionId,
    })
    useChatStore.setState({
      sessions: {
        [sessionId]: {
          messages: [{ id: 'msg-1', type: 'assistant_text', content: 'hello', timestamp: 1 }],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    render(<ActiveSession />)

    expect(screen.queryByTestId('session-terminal-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('terminal-resize-handle')).not.toBeInTheDocument()
    expect(screen.queryByTestId(`session-terminal-host-${sessionId}`)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open in Tab' })).not.toBeInTheDocument()
  })

  it('does not render a Computer Use permission modal in the web session view', () => {
    const sessionId = 'computer-use-session'

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        title: 'Computer Use Session',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 1,
        projectPath: '/tmp/project-root',
        workDir: '/tmp/project-root',
        workDirExists: true,
      }],
      activeSessionId: sessionId,
      isLoading: false,
      error: null,
    })
    useTabStore.setState({
      tabs: [{ sessionId, title: 'Computer Use Session', status: 'idle' } as ReturnType<typeof useTabStore.getState>['tabs'][number]],
      activeTabId: sessionId,
    })
    useChatStore.setState({
      sessions: {
        [sessionId]: {
          messages: [{ id: 'msg-1', type: 'assistant_text', content: 'hello', timestamp: 1 }],
          chatState: 'permission_pending',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: {
            requestId: 'cu-1',
            request: {
              requestId: 'cu-1',
              reason: 'Open Finder and inspect a file',
              apps: [],
              requestedFlags: {},
              screenshotFiltering: 'native',
            },
          },
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    render(<ActiveSession />)

    expect(screen.queryByTestId('computer-use-permission-modal')).not.toBeInTheDocument()
  })
})
