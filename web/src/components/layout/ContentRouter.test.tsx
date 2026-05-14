import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../pages/EmptySession', () => ({
  EmptySession: () => <div data-testid="empty-session" />,
}))

vi.mock('../../pages/ActiveSession', () => ({
  ActiveSession: () => <div data-testid="active-session" />,
}))

vi.mock('../../pages/ScheduledTasks', () => ({
  ScheduledTasks: () => <div data-testid="scheduled-tasks" />,
}))

vi.mock('../../pages/Settings', () => ({
  Settings: () => <div data-testid="settings-page" />,
}))

import { ContentRouter } from './ContentRouter'
import { useTabStore } from '../../stores/tabStore'

describe('ContentRouter', () => {
  afterEach(() => {
    cleanup()
    useTabStore.setState({ tabs: [], activeTabId: null })
  })

  it('renders the empty session when there is no active tab', () => {
    render(<ContentRouter />)

    expect(screen.getByTestId('empty-session')).toBeInTheDocument()
  })

  it('renders the settings page for the settings tab', () => {
    useTabStore.setState({
      tabs: [{ sessionId: '__settings__', title: 'Settings', type: 'settings', status: 'idle' }],
      activeTabId: '__settings__',
    })

    render(<ContentRouter />)

    expect(screen.getByTestId('settings-page')).toBeInTheDocument()
    expect(screen.queryByTestId('active-session')).not.toBeInTheDocument()
  })

  it('renders scheduled tasks for the scheduled tab', () => {
    useTabStore.setState({
      tabs: [{ sessionId: '__scheduled__', title: 'Scheduled', type: 'scheduled', status: 'idle' }],
      activeTabId: '__scheduled__',
    })

    render(<ContentRouter />)

    expect(screen.getByTestId('scheduled-tasks')).toBeInTheDocument()
    expect(screen.queryByTestId('active-session')).not.toBeInTheDocument()
  })

  it('renders the active session for a normal session tab', () => {
    useTabStore.setState({
      tabs: [{ sessionId: 'session-1', title: 'Chat', type: 'session', status: 'idle' }],
      activeTabId: 'session-1',
    })

    render(<ContentRouter />)

    expect(screen.getByTestId('active-session')).toBeInTheDocument()
  })
})
