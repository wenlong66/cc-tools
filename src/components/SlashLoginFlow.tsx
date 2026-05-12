import React from 'react'
import { Box, Text } from '../ink.js'

type Props = {
  onDone(): void
  startingMessage?: string
}

export function SlashLoginFlow({ startingMessage }: Props): React.ReactNode {
  return (
    <Box flexDirection="column" gap={1} marginTop={1}>
      <Text bold>
        {startingMessage ??
          'OAuth login is disabled in CC-Tools. Configure an API provider instead.'}
      </Text>
      <Text>
        CC-Tools now runs in API-only mode and no longer supports Claude or
        OpenAI OAuth login.
      </Text>
    </Box>
  )
}
