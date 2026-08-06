import type { LngLat } from './types';

export interface Pose {
  position: LngLat | null;
  headingDeg: number | null; // degrees clockwise from true north
  pitchDeg: number | null; // device pitch, needed for §8 height-occlusion in AR mode
  headingSource: 'compass' | 'manual' | null;
  /** webkitCompassAccuracy in degrees; <0 or >25 means poor (§6, "figure-8 to calibrate"). null off iOS/no reading yet. */
  headingAccuracyDeg: number | null;
}

export type PoseListener = (pose: Pose) => void;

/** Circular low-pass filter over a heading in degrees. Kills compass jitter (§6). */
export class HeadingSmoother {
  private sin = 0;
  private cos = 1;
  private initialized = false;

  constructor(private readonly alpha = 0.25) {}

  push(headingDeg: number): number {
    const rad = (headingDeg * Math.PI) / 180;
    if (!this.initialized) {
      this.sin = Math.sin(rad);
      this.cos = Math.cos(rad);
      this.initialized = true;
    } else {
      this.sin = this.sin + this.alpha * (Math.sin(rad) - this.sin);
      this.cos = this.cos + this.alpha * (Math.cos(rad) - this.cos);
    }
    const smoothed = (Math.atan2(this.sin, this.cos) * 180) / Math.PI;
    return (smoothed + 360) % 360;
  }
}

type DeviceOrientationEventWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

/** Gesture-gated iOS permission request; no-op (always allowed) on other platforms (§6). */
export async function requestCompassPermission(): Promise<'granted' | 'denied' | 'unsupported'> {
  const ctor = (globalThis as { DeviceOrientationEvent?: DeviceOrientationEventWithPermission })
    .DeviceOrientationEvent;
  if (!ctor) return 'unsupported';
  if (typeof ctor.requestPermission !== 'function') return 'granted'; // non-iOS
  try {
    return await ctor.requestPermission();
  } catch {
    return 'denied';
  }
}

function screenAngle(): number {
  const so = (screen as unknown as { orientation?: { angle?: number } }).orientation;
  if (so?.angle !== undefined) return so.angle;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return legacy ?? 0;
}

/** Extracts a true-north heading from a device orientation event (§6). Returns null if unusable. */
export function headingFromOrientationEvent(
  event: DeviceOrientationEvent & { webkitCompassHeading?: number; absolute?: boolean },
): number | null {
  if (typeof event.webkitCompassHeading === 'number') {
    // iOS: already true-north and screen-corrected.
    return event.webkitCompassHeading;
  }
  if (event.absolute === true && event.alpha !== null) {
    return (360 - event.alpha - screenAngle() + 360) % 360;
  }
  // Ignore relative-only events — they drift (§6).
  return null;
}

export class PoseManager {
  private readonly pose: Pose = {
    position: null,
    headingDeg: null,
    pitchDeg: null,
    headingSource: null,
    headingAccuracyDeg: null,
  };

  private readonly smoother = new HeadingSmoother();
  private readonly listeners = new Set<PoseListener>();
  private manualOffsetDeg = 0;
  private rafPending = false;
  private latestEvent: (DeviceOrientationEvent & { webkitCompassHeading?: number }) | null = null;
  private watchId: number | null = null;

  onChange(listener: PoseListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener({ ...this.pose });
  }

  setManualPosition(position: LngLat): void {
    this.pose.position = position;
    this.emit();
  }

  /** Clears position/heading (e.g. an old position is meaningless after jumping cities). Live compass/geolocation watches, if running, keep running and will overwrite this on their next reading. */
  reset(): void {
    this.pose.position = null;
    this.pose.headingDeg = null;
    this.pose.headingSource = null;
    this.pose.headingAccuracyDeg = null;
    this.emit();
  }

  setManualHeading(headingDeg: number): void {
    this.pose.headingDeg = ((headingDeg % 360) + 360) % 360;
    this.pose.headingSource = 'manual';
    this.pose.headingAccuracyDeg = null;
    this.emit();
  }

  /** Trims residual compass bias (§6) without discarding the live compass reading. */
  setManualHeadingOffset(offsetDeg: number): void {
    this.manualOffsetDeg = offsetDeg;
  }

  startGeolocation(): void {
    if (this.watchId !== null || !('geolocation' in navigator)) return;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.pose.position = { lng: pos.coords.longitude, lat: pos.coords.latitude };
        this.emit();
      },
      () => undefined,
      { enableHighAccuracy: true },
    );
  }

  stopGeolocation(): void {
    if (this.watchId === null) return;
    navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  async startCompass(): Promise<'granted' | 'denied' | 'unsupported'> {
    const result = await requestCompassPermission();
    if (result !== 'granted') return result;
    const handler = (
      event: DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number },
    ) => {
      this.latestEvent = event;
      if (this.rafPending) return;
      this.rafPending = true;
      requestAnimationFrame(() => {
        this.rafPending = false;
        if (!this.latestEvent) return;
        const raw = headingFromOrientationEvent(this.latestEvent);
        if (raw === null) return;
        const smoothed = this.smoother.push(raw);
        this.pose.headingDeg = ((smoothed + this.manualOffsetDeg) % 360 + 360) % 360;
        this.pose.headingSource = 'compass';
        const accuracy = (this.latestEvent as { webkitCompassAccuracy?: number }).webkitCompassAccuracy;
        this.pose.headingAccuracyDeg = typeof accuracy === 'number' ? accuracy : null;
        this.emit();
      });
    };
    window.addEventListener('deviceorientationabsolute', handler as EventListener);
    window.addEventListener('deviceorientation', handler as EventListener);
    return 'granted';
  }

  getPose(): Pose {
    return { ...this.pose };
  }
}
