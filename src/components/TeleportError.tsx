import React, { useCallback, useEffect, useState } from 'react'
import {
  checkIsGitClean,
  checkNeedsClaudeAiLogin,
} from 'src/utils/background/remote/preconditions.js'
import { gracefulShutdownSync } from 'src/utils/gracefulShutdown.js'
import { Box, Text } from '../ink.js'
import { Select } from './CustomSelect/index.js'
import { Dialog } from './design-system/Dialog.js'
import { TeleportStash } from './TeleportStash.js'

export type TeleportLocalErrorType = 'needsLogin' | 'needsGitStash'

type TeleportErrorProps = {
  onComplete: () => void
  errorsToIgnore?: ReadonlySet<TeleportLocalErrorType>
}

const EMPTY_ERRORS_TO_IGNORE: ReadonlySet<TeleportLocalErrorType> = new Set()

export function TeleportError({
  onComplete,
  errorsToIgnore = EMPTY_ERRORS_TO_IGNORE,
}: TeleportErrorProps): React.ReactNode {
  const [currentError, setCurrentError] =
    useState<TeleportLocalErrorType | null>(null)

  const checkErrors = useCallback(async () => {
    const currentErrors = await getTeleportErrors()
    const filteredErrors = new Set(
      Array.from(currentErrors).filter(
        (error: TeleportLocalErrorType) => !errorsToIgnore.has(error),
      ),
    )

    if (filteredErrors.size === 0) {
      onComplete()
      return
    }

    if (filteredErrors.has('needsLogin')) {
      setCurrentError('needsLogin')
    } else if (filteredErrors.has('needsGitStash')) {
      setCurrentError('needsGitStash')
    }
  }, [onComplete, errorsToIgnore])

  useEffect(() => {
    void checkErrors()
  }, [checkErrors])

  const onCancel = useCallback(() => {
    gracefulShutdownSync(0)
  }, [])

  const handleStashComplete = useCallback(() => {
    void checkErrors()
  }, [checkErrors])

  if (!currentError) {
    return null
  }

  switch (currentError) {
    case 'needsGitStash':
      return (
        <TeleportStash
          onStashAndContinue={handleStashComplete}
          onCancel={onCancel}
        />
      )

    case 'needsLogin':
      return (
        <Dialog title="Teleport unavailable" onCancel={onCancel}>
          <Box flexDirection="column">
            <Text dimColor>
              Teleport is unavailable in CC-Tools because OAuth login is
              disabled.
            </Text>
            <Text dimColor>
              Configure an API provider instead, or exit this flow.
            </Text>
          </Box>
          <Select
            options={[{ label: 'Exit', value: 'exit' }]}
            onChange={() => onCancel()}
          />
        </Dialog>
      )
  }
}

export async function getTeleportErrors(): Promise<
  Set<TeleportLocalErrorType>
> {
  const errors = new Set<TeleportLocalErrorType>()

  const [needsLogin, isGitClean] = await Promise.all([
    checkNeedsClaudeAiLogin(),
    checkIsGitClean(),
  ])

  if (needsLogin) {
    errors.add('needsLogin')
  }
  if (!isGitClean) {
    errors.add('needsGitStash')
  }

  return errors
}
