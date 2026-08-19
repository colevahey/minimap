import { useEffect, useState } from 'react';
import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { Text } from '@coinbase/cds-web/typography';
import { Button, IconButton } from '@coinbase/cds-web/buttons';
import { YEAR_COLOR_BUCKETS, YEAR_COLOR_NO_DATA, type MapModeController, type MapModeState } from '../map/mapMode';
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

function CollapseToggle({
  expanded,
  onClick,
  label,
  expandDirection,
}: {
  expanded: boolean;
  onClick: () => void;
  label: string;
  /** Which way this panel's content grows when expanded — down for a panel
   * anchored to the top edge, up for one anchored to the bottom edge. */
  expandDirection: 'down' | 'up';
}) {
  // A single glyph (arrowDown), rotated with CSS, rather than picking a
  // different icon name per direction — arrowLeft in this icon font is
  // drawn in a visibly different style (solid triangle head) from
  // arrowUp/arrowDown (clean converging lines), so mixing icon names made
  // the two states look inconsistent. Rotating one glyph guarantees they
  // always match.
  // down=0deg, left=90deg (clockwise), up=180deg.
  const rotationDeg = expanded ? (expandDirection === 'down' ? 0 : 180) : 90;
  return (
    <IconButton
      size="s"
      variant="tertiary"
      name="arrowDown"
      accessibilityLabel={label}
      onClick={onClick}
      style={{ transform: `rotate(${rotationDeg}deg)` }}
    />
  );
}

const AI_GRADIENT_KEYFRAMES = `
@keyframes ai-glow-shift {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
`;

/** Wraps a control in a shifting rainbow-gradient ring — the "AI feature"
 * visual shorthand (Gemini/Copilot-style) marking AR as the vision-powered mode. */
function AiGlowRing({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'inline-block',
        borderRadius: 9999,
        padding: 2,
        background: 'linear-gradient(90deg, #4285f4, #9b72cb, #ee5a6f, #f2a93b, #4285f4)',
        backgroundSize: '300% 100%',
        animation: 'ai-glow-shift 4s ease infinite',
      }}
    >
      {children}
    </div>
  );
}

function IdentifyPanelDetails({ hit }: { hit: RaycastHit }) {
  return (
    <>
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
 *
 * Both the controls panel and the identify panel default to collapsed on
 * mount — on a phone they'd otherwise eat most of the screen over the
 * map/camera view they're supposed to be an overlay on top of.
 */
export function App({ controller, arController, mapContainer, arContainer }: AppProps) {
  const [mode, setMode] = useState<Mode>('map');
  const [mapState, setMapState] = useState<MapModeState>(() => ({
    pose: controller.pose.getPose(),
    hit: null,
    city: 'sea',
    colorByYear: false,
  }));
  const [arState, setArState] = useState<ArModeState>(() => ({
    pose: controller.pose.getPose(),
    hit: null,
    locked: false,
    cameraStatus: 'idle',
  }));
  const [compassStatus, setCompassStatus] = useState<CompassStatus>('idle');
  const [controlsExpanded, setControlsExpanded] = useState(false);
  const [panelExpanded, setPanelExpanded] = useState(false);
  const [legendVisible, setLegendVisible] = useState(false);

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
  const { city, colorByYear } = mapState;
  const poorAccuracy =
    pose.headingAccuracyDeg !== null && (pose.headingAccuracyDeg < 0 || pose.headingAccuracyDeg > 25);
  const showPanelDetails = (mode === 'map' || arState.cameraStatus === 'active') && hit != null;

  return (
    <>
      <style>{AI_GRADIENT_KEYFRAMES}</style>
      <Box position="absolute" top={0} left={0} right={0} padding={3} style={{ pointerEvents: 'none' }}>
        <VStack
          gap={2}
          background="bg"
          borderRadius={400}
          padding={3}
          elevation={2}
          style={{ pointerEvents: 'auto', maxWidth: 360 }}
        >
          <HStack gap={2} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Text as="h1" font="title3">
              Minimap
            </Text>
            <CollapseToggle
              expanded={controlsExpanded}
              onClick={() => setControlsExpanded((v) => !v)}
              label={controlsExpanded ? 'Collapse controls' : 'Expand controls'}
              expandDirection="down"
            />
          </HStack>

          {controlsExpanded && (
            <>
              <HStack gap={2} style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
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
                  <AiGlowRing>
                    <Button size="xs" variant={mode === 'ar' ? 'primary' : 'tertiary'} onClick={() => setMode('ar')}>
                      AR
                    </Button>
                  </AiGlowRing>
                </HStack>
              </HStack>

              {mode === 'map' && (
                <VStack gap={0.5}>
                  <HStack gap={0.5} style={{ alignItems: 'center' }}>
                    <Button
                      size="xs"
                      variant={colorByYear ? 'primary' : 'tertiary'}
                      onClick={() => controller.setColorByYear(!colorByYear)}
                    >
                      Color by year built
                    </Button>
                    {colorByYear && (
                      // Tap to reveal, not true CSS hover — there's no hover
                      // state on a phone touchscreen, and a tap works on both.
                      <IconButton
                        size="xs"
                        variant="tertiary"
                        name="info"
                        accessibilityLabel={legendVisible ? 'Hide legend' : 'Show legend'}
                        onClick={() => setLegendVisible((v) => !v)}
                      />
                    )}
                  </HStack>
                  {colorByYear && legendVisible && (
                    // Fixed 4-column grid, not flex-wrap — a predictable compact
                    // block (2 short rows) regardless of viewport width, instead
                    // of an unpredictable wrap of 9 variable-width chips.
                    <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px 6px' }}>
                      {[...YEAR_COLOR_BUCKETS, { label: 'no data', color: YEAR_COLOR_NO_DATA }].map((bucket) => (
                        <HStack key={bucket.label} gap={0.25} style={{ alignItems: 'center' }}>
                          <Box
                            borderRadius={100}
                            style={{ width: 8, height: 8, flexShrink: 0, backgroundColor: bucket.color }}
                          />
                          <Text font="legal" color="fgMuted" style={{ whiteSpace: 'nowrap' }}>
                            {bucket.label}
                          </Text>
                        </HStack>
                      ))}
                    </Box>
                  )}
                </VStack>
              )}

              <HStack gap={1}>
                <IconButton
                  size="s"
                  variant={pose.position ? 'secondary' : 'primary'}
                  name="location"
                  accessibilityLabel={pose.position ? 'Location on' : 'Use my location'}
                  onClick={() => controller.pose.startGeolocation()}
                />
                <IconButton
                  size="s"
                  variant={compassStatus === 'denied' ? 'negative' : pose.headingSource === 'compass' ? 'secondary' : 'primary'}
                  name="compass"
                  accessibilityLabel={pose.headingSource === 'compass' ? 'Compass on' : 'Use compass'}
                  onClick={async () => setCompassStatus(await controller.pose.startCompass())}
                />
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
            </>
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
          {(mode === 'map' || arState.cameraStatus === 'active') && (
            <>
              <HStack gap={1} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Text as="h2" font="title3" style={{ flex: 1 }}>
                  {hit ? hit.b.name ?? 'Unidentified building' : 'Point at a building to identify it'}
                </Text>
                {showPanelDetails && (
                  <CollapseToggle
                    expanded={panelExpanded}
                    onClick={() => setPanelExpanded((v) => !v)}
                    label={panelExpanded ? 'Collapse details' : 'Expand details'}
                    expandDirection="up"
                  />
                )}
              </HStack>
              {showPanelDetails && panelExpanded && hit && <IdentifyPanelDetails hit={hit} />}
            </>
          )}
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
