import { useEffect, useState } from 'react';
import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { Text } from '@coinbase/cds-web/typography';
import { Button } from '@coinbase/cds-web/buttons';
import type { MapModeController, MapModeState } from '../map/mapMode';
import type { ArModeController, ArModeState } from '../ar/arMode';
import type { RaycastHit } from '../core/raycast';

type CompassStatus = 'idle' | 'granted' | 'denied' | 'unsupported';
type Mode = 'map' | 'ar';

interface AppProps {
  controller: MapModeController;
  arController: ArModeController;
  mapContainer: HTMLElement;
  arContainer: HTMLElement;
}

function IdentifyPanelContent({ hit }: { hit: RaycastHit }) {
  return (
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
        {hit.b.owner ? `Registered owner: ${hit.b.owner}` : 'Registered owner: unavailable'} · {Math.round(hit.t)} m
        away
      </Text>
      <Text font="legal" color="fgMuted">
        {hit.b.source}
      </Text>
    </>
  );
}

/**
 * The React/CDS UI overlay. Renders on top of the vanilla-TS map/AR canvas
 * (see main.tsx) — never the other way around, so the perf-sensitive render
 * loop in map/AR mode is never inside a React tree. This component only
 * reads state via `onUpdate` and issues commands back to the controllers; it
 * never touches MapLibre, getUserMedia, or the pose pipeline directly.
 */
export function App({ controller, arController, mapContainer, arContainer }: AppProps) {
  const [mode, setMode] = useState<Mode>('map');
  const [mapState, setMapState] = useState<MapModeState>(() => ({
    pose: controller.pose.getPose(),
    hit: null,
    city: 'sea',
  }));
  const [arState, setArState] = useState<ArModeState>(() => ({
    pose: controller.pose.getPose(),
    hit: null,
    locked: false,
    cameraStatus: 'idle',
  }));
  const [compassStatus, setCompassStatus] = useState<CompassStatus>('idle');

  useEffect(() => controller.onUpdate(setMapState), [controller]);
  useEffect(() => arController.onUpdate(setArState), [arController]);

  useEffect(() => {
    mapContainer.style.display = mode === 'map' ? 'block' : 'none';
    arContainer.style.display = mode === 'ar' ? 'block' : 'none';
    if (mode === 'ar') {
      arController.start();
    } else {
      arController.stop();
    }
  }, [mode, arController, mapContainer, arContainer]);

  const pose = mode === 'ar' ? arState.pose : mapState.pose;
  const hit = mode === 'ar' ? arState.hit : mapState.hit;
  const { city } = mapState;
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
          <HStack gap={2} style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
            <Text as="h1" font="title3">
              Minimap
            </Text>
            <HStack gap={0.5}>
              <Button size="xs" variant={city === 'sea' ? 'primary' : 'tertiary'} onClick={() => controller.switchCity('sea')}>
                Seattle
              </Button>
              <Button size="xs" variant={city === 'nyc' ? 'primary' : 'tertiary'} onClick={() => controller.switchCity('nyc')}>
                NYC
              </Button>
            </HStack>
            <HStack gap={0.5}>
              <Button size="xs" variant={mode === 'map' ? 'primary' : 'tertiary'} onClick={() => setMode('map')}>
                Map
              </Button>
              <Button size="xs" variant={mode === 'ar' ? 'primary' : 'tertiary'} onClick={() => setMode('ar')}>
                AR
              </Button>
            </HStack>
          </HStack>

          <HStack gap={1}>
            <Button
              size="s"
              variant={pose.position ? 'secondary' : 'primary'}
              onClick={() => controller.pose.startGeolocation()}
            >
              {pose.position ? 'Location on' : 'Use my location'}
            </Button>
            <Button
              size="s"
              variant={compassStatus === 'denied' ? 'negative' : pose.headingSource === 'compass' ? 'secondary' : 'primary'}
              onClick={async () => setCompassStatus(await controller.pose.startCompass())}
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
              onChange={(e) => controller.pose.setManualHeading(Number(e.target.value))}
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
                onChange={(e) => controller.pose.setManualHeadingOffset(Number(e.target.value))}
                style={{ width: '100%' }}
                aria-label="Compass offset nudge"
              />
            </VStack>
          )}

          {mode === 'ar' && (
            <VStack gap={0.5}>
              <Text font="caption" color="fgMuted">
                Pitch (§8 height-occlusion) {pose.pitchDeg !== null ? `${Math.round(pose.pitchDeg)}°` : 'unset'}
              </Text>
              <input
                type="range"
                min={-45}
                max={80}
                value={Math.round(pose.pitchDeg ?? 0)}
                onChange={(e) => controller.pose.setManualPitch(Number(e.target.value))}
                style={{ width: '100%' }}
                aria-label="Manual pitch"
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
          {mode === 'ar' && arState.cameraStatus === 'starting' && (
            <Text font="body" color="fgMuted">
              Starting camera…
            </Text>
          )}
          {mode === 'ar' && arState.cameraStatus === 'denied' && (
            <>
              <Text font="body" color="fgNegative">
                Camera permission denied.
              </Text>
              <Button size="s" variant="secondary" onClick={() => setMode('map')}>
                Switch to map mode
              </Button>
            </>
          )}
          {mode === 'ar' && arState.cameraStatus === 'unsupported' && (
            <>
              <Text font="body" color="fgMuted">
                Camera not supported on this device.
              </Text>
              <Button size="s" variant="secondary" onClick={() => setMode('map')}>
                Switch to map mode
              </Button>
            </>
          )}
          {(mode === 'map' || arState.cameraStatus === 'active') &&
            (hit ? <IdentifyPanelContent hit={hit} /> : (
              <Text font="body" color="fgMuted">
                Point at a building to identify it. Tap "Use my location" to start.
              </Text>
            ))}
          {mode === 'ar' && arState.cameraStatus === 'active' && (
            <Text font="legal" color="fgMuted">
              {arState.locked ? 'Locked — tap the camera to release' : 'Tap the camera to lock this building'}
            </Text>
          )}
        </VStack>
      </Box>
    </>
  );
}
