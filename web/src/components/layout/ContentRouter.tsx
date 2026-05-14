import type { ReactNode } from 'react'
import { useTabStore } from '../../stores/tabStore'
import { EmptySession } from '../../pages/EmptySession'
import { ActiveSession } from '../../pages/ActiveSession'
import { ScheduledTasks } from '../../pages/ScheduledTasks'
import { Settings } from '../../pages/Settings'

export function ContentRouter() {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const tabs = useTabStore((s) => s.tabs)
  const activeTabType = tabs.find((t) => t.sessionId === activeTabId)?.type

  let page: ReactNode = null
  if (!activeTabId || !activeTabType) {
    page = <EmptySession />
  } else if (activeTabType === 'settings') {
    page = <Settings />
  } else if (activeTabType === 'scheduled') {
    page = <ScheduledTasks />
  } else {
    page = <ActiveSession />
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {page && (
        <div className="absolute inset-0 z-10 flex min-h-0 flex-col overflow-hidden">
          {page}
        </div>
      )}
    </div>
  )
}
