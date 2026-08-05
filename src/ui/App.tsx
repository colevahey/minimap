import { Box, VStack } from '@coinbase/cds-web/layout';
import { Text } from '@coinbase/cds-web/typography';

/**
 * The React/CDS UI overlay. Renders on top of the vanilla-TS map/AR canvas
 * (see main.tsx) — never the other way around, so the perf-sensitive render
 * loop in map/AR mode is never inside a React tree.
 */
export function App() {
  return (
    <Box position="absolute" bottom={0} left={0} right={0} padding={3} style={{ pointerEvents: 'none' }}>
      <VStack
        gap={1}
        background="bg"
        borderRadius={400}
        padding={3}
        elevation={2}
        style={{ pointerEvents: 'auto' }}
      >
        <Text as="h1" font="title3">
          Siteline
        </Text>
        <Text font="body" color="fgMuted">
          Point at a building to identify it. Tap "Use my location" to start.
        </Text>
      </VStack>
    </Box>
  );
}
