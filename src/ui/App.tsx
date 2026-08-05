import { useEffect, useState } from 'react';
import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { Text } from '@coinbase/cds-web/typography';
import { Button } from '@coinbase/cds-web/buttons';
import type { MapModeController, MapModeState } from '../map/mapMode';

type CompassStatus = 'idle' | 'granted' | 'denied' | 'unsupported';

interface AppProps {
  controller: MapModeController;
}

/**
 * The React/CDS UI overlay. Renders on top of the vanilla-TS map/AR canvas
 * (see main.tsx) — never the other way around, so the perf-sensitive render
 * loop in map/AR mode is never inside a React tree. This component only
 * reads state via `controller.onUpdate` and issues commands back to it; it
 * never touches MapLibre or the pose pipeline directly.
 */
export function App({ controller }: AppProps) {
  const [state, setState] = useState<MapModeState>(() => ({
    pose: controller.pose.getPose(),
    hit: null,
  }));
  const [compassStatus, setCompassStatus] = useState<CompassStatus>('idle');

  useEffect(() => controller.onUpdate(setState), [controller]);

  const { pose, hit } = state;
  const poorAccuracy =
    pose.headingAccuracyDeg !== null && (pose.headingAccuracyDeg < 0 || pose.headingAccuracyDeg > 25);

  return (
    <>
      <Box position="absolute" top={0} left={0} right={0} padding={3} style={{ pointerEvents: 'none' }}>
        <VStack
          gap={2}
          background="bg"
          borderRadius={400}
          padding={3}
          elevation={2}
          style={{ pointerEvents: 'auto', maxWidth: 360 }}
        >
          <Text as="h1" font="title3">
            Minimap
          </Text>

          <HStack gap={1}>
            <Button size="s" variant={pose.position ? 'secondary' : 'primary'} onClick={() => controller.useMyLocation()}>
              {pose.position ? 'Location on' : 'Use my location'}
            </Button>
            <Button
              size="s"
              variant={compassStatus === 'denied' ? 'negative' : pose.headingSource === 'compass' ? 'secondary' : 'primary'}
              onClick={async () => setCompassStatus(await controller.useCompass())}
            >
              {pose.headingSource === 'compass' ? 'Compass on' : 'Use compass'}
            </Button>
          </HStack>

          {compassStatus === 'denied' && (
            <Text font="caption" color="fgNegative">
              Compass permission denied — use the heading slider below.
            </Text>
          )}
          {compassStatus === 'unsupported' && (
            <Text font="caption" color="fgMuted">
              No compass sensor on this device — use the heading slider below.
            </Text>
          )}
          {poorAccuracy && (
            <Text font="caption" color="fgWarning">
              Compass accuracy is poor — figure-8 the phone to calibrate.
            </Text>
          )}

          <VStack gap={0.5}>
            <Text font="caption" color="fgMuted">
              Heading {pose.headingDeg !== null ? `${Math.round(pose.headingDeg)}°` : 'unset'}
            </Text>
            <input
              type="range"
              min={0}
              max={359}
              value={Math.round(pose.headingDeg ?? 0)}
              onChange={(e) => controller.setManualHeading(Number(e.target.value))}
              style={{ width: '100%' }}
              aria-label="Manual heading"
            />
          </VStack>

          {pose.headingSource === 'compass' && (
            <VStack gap={0.5}>
              <Text font="caption" color="fgMuted">
                Heading offset nudge
              </Text>
              <input
                type="range"
                min={-30}
                max={30}
                defaultValue={0}
                onChange={(e) => controller.setManualHeadingOffset(Number(e.target.value))}
                style={{ width: '100%' }}
                aria-label="Compass offset nudge"
              />
            </VStack>
          )}
        </VStack>
      </Box>

      <Box position="absolute" bottom={0} left={0} right={0} padding={3} style={{ pointerEvents: 'none' }}>
        <VStack
          gap={1}
          background="bg"
          borderRadius={400}
          padding={3}
          elevation={2}
          style={{ pointerEvents: 'auto' }}
        >
          {hit ? (
            <>
              <Text as="h2" font="title3">
                {hit.b.name ?? 'Unidentified building'}
              </Text>
              <Text font="body" color="fgMuted">
                {[
                  hit.b.floors != null ? `${hit.b.floors} floors` : null,
                  hit.b.height_m != null ? `~${Math.round(hit.b.height_m)} m` : null,
                  hit.b.year_built != null ? `built ${hit.b.year_built}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'No attribute data for this building'}
              </Text>
              <Text font="caption" color="fgMuted">
                {hit.b.owner ? `Registered owner: ${hit.b.owner}` : 'Registered owner: unavailable'} ·{' '}
                {Math.round(hit.t)} m away
              </Text>
              <Text font="legal" color="fgMuted">
                {hit.b.source}
              </Text>
            </>
          ) : (
            <Text font="body" color="fgMuted">
              Point at a building to identify it. Tap "Use my location" to start.
            </Text>
          )}
        </VStack>
      </Box>
    </>
  );
}
