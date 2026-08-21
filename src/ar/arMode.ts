import type { MapModeController } from '../map/mapMode';
import { toLocal } from '../core/geo';
import type { Pose } from '../core/pose';
import { raycastWithPitch, type RaycastHit } from '../core/raycast';
import { queryNearbyBuildings } from '../core/buildings';
import { EYE_HEIGHT_M, M_PER_FLOOR } from '../core/constants';
import type { BuildingWithRing, LngLat } from '../core/types';

const RAY_MAX_RANGE_M = 650;
// Rough back-camera FOV — not per-device calibrated (§7 is a 2D canvas
// overlay, not a real camera-intrinsics AR framework), so outlines will
// drift a bit on devices with a notably wider/narrower lens than this.
// Vertical is set independently rather than derived from the horizontal
// value times the portrait aspect ratio (390/844 ≈ 2.16×) — that formula
// gives a ~140° vertical FOV, well past fisheye territory and nothing like
// an actual phone camera, which made buildings project to the wrong place
// on screen relative to where they actually are.
const HORIZONTAL_FOV_DEG = 65;
const VERTICAL_FOV_DEG = 75;

export type CameraStatus = 'idle' | 'starting' | 'active' | 'denied' | 'unsupported' | 'error';

export interface ArModeState {
  pose: Pose;
  hit: RaycastHit | null;
  locked: boolean;
  cameraStatus: CameraStatus;
}

export type ArModeListener = (state: ArModeState) => void;

interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Camera passthrough + orientation overlay (§7). Shares the host
 * MapModeController's `pose` and `map` (for building queries against
 * whichever city's PMTiles source is currently loaded) rather than owning
 * its own — position/heading/city must stay unified across a mode switch.
 * The overlay is a `<canvas>` re-drawn every animation frame; identification
 * uses `raycastWithPitch` (§8) instead of plain `raycast` so a nearer short
 * building doesn't wrongly win over a taller one you're looking over.
 */
export class ArModeController {
  private readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly mapController: MapModeController;
  private readonly listeners = new Set<ArModeListener>();
  private readonly onClick = () => this.toggleLock();
  private readonly onResize = () => this.resizeCanvas();

  private stream: MediaStream | null = null;
  private rafId: number | null = null;
  private cameraStatus: CameraStatus = 'idle';
  private currentHit: RaycastHit | null = null;
  private lockedHit: RaycastHit | null = null;
  private nearbyBuildings: BuildingWithRing[] = [];
  private unsubscribePose: (() => void) | null = null;

  constructor(video: HTMLVideoElement, canvas: HTMLCanvasElement, mapController: MapModeController) {
    this.video = video;
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.mapController = mapController;
  }

  async start(): Promise<void> {
    this.cameraStatus = 'starting';
    this.emit();

    if (!navigator.mediaDevices?.getUserMedia) {
      this.cameraStatus = 'unsupported';
      this.emit();
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
    } catch {
      this.cameraStatus = 'denied';
      this.emit();
      return;
    }

    this.video.srcObject = this.stream;
    await this.video.play();
    this.resizeCanvas();
    window.addEventListener('resize', this.onResize);
    this.canvas.addEventListener('click', this.onClick);

    this.cameraStatus = 'active';
    this.unsubscribePose = this.mapController.pose.onChange((pose) => this.onPoseChange(pose));
    this.onPoseChange(this.mapController.pose.getPose());
    this.loop();
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.unsubscribePose?.();
    this.unsubscribePose = null;
    window.removeEventListener('resize', this.onResize);
    this.canvas.removeEventListener('click', this.onClick);
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.video.srcObject = null;
    this.lockedHit = null;
    this.cameraStatus = 'idle';
    this.emit();
  }

  private resizeCanvas(): void {
    this.canvas.width = this.canvas.clientWidth;
    this.canvas.height = this.canvas.clientHeight;
  }

  private onPoseChange(pose: Pose): void {
    if (pose.position) {
      // Keep the shared map centred near the observer so its vector tiles
      // (and therefore queryNearbyBuildings) stay populated while walking
      // around. Map mode's own viewport is user-controlled and untouched —
      // this only runs while AR is active.
      this.mapController.map.jumpTo({ center: [pose.position.lng, pose.position.lat], zoom: 16 });
      this.nearbyBuildings = queryNearbyBuildings(this.mapController.map);
    } else {
      this.nearbyBuildings = [];
    }

    if (!pose.position || pose.headingDeg === null) {
      this.currentHit = null;
      this.emit();
      return;
    }

    const pitch = pose.pitchDeg ?? 0;
    this.currentHit = raycastWithPitch(pose.position, pose.headingDeg, pitch, this.nearbyBuildings, RAY_MAX_RANGE_M);
    this.emit();
  }

  private toggleLock(): void {
    this.lockedHit = this.lockedHit ? null : this.currentHit;
    this.emit();
  }

  private loop = (): void => {
    this.draw();
    this.rafId = requestAnimationFrame(this.loop);
  };

  private project(
    azimuthDeg: number,
    elevationDeg: number,
    headingDeg: number,
    pitchDeg: number,
    width: number,
    height: number,
  ): ScreenPoint | null {
    const relAz = (((azimuthDeg - headingDeg + 180) % 360) + 360) % 360 - 180;
    const relEl = elevationDeg - pitchDeg;

    const hFovHalf = HORIZONTAL_FOV_DEG / 2;
    const vFovHalf = VERTICAL_FOV_DEG / 2;
    if (Math.abs(relAz) > hFovHalf || Math.abs(relEl) > vFovHalf) return null;

    return {
      x: width / 2 + (relAz / hFovHalf) * (width / 2),
      y: height / 2 - (relEl / vFovHalf) * (height / 2),
    };
  }

  /** Projects a building's ring at a given height-above-ground (0 = base) into screen space. */
  private projectRing(
    ring: BuildingWithRing['ring'],
    heightAboveGround: number,
    observer: LngLat,
    headingDeg: number,
    pitchDeg: number,
    width: number,
    height: number,
  ): (ScreenPoint | null)[] {
    return ring.map(([lng, lat]) => {
      const local = toLocal(lng, lat, observer);
      const dist = Math.hypot(local.x, local.y);
      if (dist < 0.5 || dist > RAY_MAX_RANGE_M) return null;
      const azimuth = (Math.atan2(local.x, local.y) * 180) / Math.PI;
      const elevation = (Math.atan2(heightAboveGround - EYE_HEIGHT_M, dist) * 180) / Math.PI;
      return this.project(azimuth, elevation, headingDeg, pitchDeg, width, height);
    });
  }

  private strokePolyline(points: (ScreenPoint | null)[], color: string, width: number): void {
    const { ctx } = this;
    ctx.beginPath();
    let started = false;
    for (const p of points) {
      if (!p) {
        started = false;
        continue;
      }
      if (!started) {
        ctx.moveTo(p.x, p.y);
        started = true;
      } else {
        ctx.lineTo(p.x, p.y);
      }
    }
    ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  /**
   * Draws a building as a wireframe box (base ring + roof ring + vertical
   * edges connecting corresponding corners) rather than just its flat
   * ground footprint — a footprint outline alone traces where the building
   * *starts*, not the vertical facade you actually see through the camera,
   * which is what read as a "flat silhouette" floating in the frame rather
   * than an outline anchored to the real building. Every building gets a
   * roof height (real height_m, or the same floors×3.5m/flat-placeholder
   * fallback raycastWithPitch and map mode use), not just the current hit.
   */
  private drawBuildingWireframe(
    b: BuildingWithRing,
    observer: LngLat,
    headingDeg: number,
    pitchDeg: number,
    width: number,
    height: number,
    isHit: boolean,
  ): void {
    const roofHeight = b.height_m ?? (b.floors != null ? b.floors * M_PER_FLOOR : M_PER_FLOOR);
    const base = this.projectRing(b.ring, 0, observer, headingDeg, pitchDeg, width, height);
    const roof = this.projectRing(b.ring, roofHeight, observer, headingDeg, pitchDeg, width, height);

    const anyBaseVisible = base.some((p) => p !== null);
    const anyRoofVisible = roof.some((p) => p !== null);
    if (!anyBaseVisible && !anyRoofVisible) return;

    const color = isHit ? '#ff9d3f' : 'rgba(93,184,255,0.7)';
    const lineWidth = isHit ? 3 : 1.5;
    if (anyBaseVisible) this.strokePolyline(base, color, lineWidth);
    if (anyRoofVisible) this.strokePolyline(roof, color, lineWidth);

    // Vertical corner edges — only where both ends are on-screen. A corner
    // whose base fell outside the FOV (e.g. base below frame when pitched
    // up at a very tall/near building) just doesn't get a connecting edge,
    // rather than being clipped and extended to the screen boundary — a
    // known simplification (per-vertex FOV clipping, not full line/frustum
    // clipping), so a wall can still visually "stop" mid-air in that case
    // instead of running off the bottom of the screen like it would in reality.
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    for (let i = 0; i < base.length; i++) {
      const basePoint = base[i];
      const roofPoint = roof[i];
      if (!basePoint || !roofPoint) continue;
      ctx.beginPath();
      ctx.moveTo(basePoint.x, basePoint.y);
      ctx.lineTo(roofPoint.x, roofPoint.y);
      ctx.stroke();
    }
  }

  private draw(): void {
    const { ctx, canvas } = this;
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const pose = this.mapController.pose.getPose();
    if (!pose.position || pose.headingDeg === null) return;
    const { position: observer, headingDeg } = pose;
    const pitchDeg = pose.pitchDeg ?? 0;

    for (const b of this.nearbyBuildings) {
      const isHit = this.currentHit?.b.id === b.id;
      this.drawBuildingWireframe(b, observer, headingDeg, pitchDeg, width, height, isHit);
    }
  }

  private emit(): void {
    const state: ArModeState = {
      pose: this.mapController.pose.getPose(),
      hit: this.lockedHit ?? this.currentHit,
      locked: this.lockedHit !== null,
      cameraStatus: this.cameraStatus,
    };
    for (const listener of this.listeners) listener(state);
  }

  /** Subscribes to pose/hit/lock/camera-status updates; immediately replays the current state. */
  onUpdate(listener: ArModeListener): () => void {
    this.listeners.add(listener);
    listener({
      pose: this.mapController.pose.getPose(),
      hit: this.lockedHit ?? this.currentHit,
      locked: this.lockedHit !== null,
      cameraStatus: this.cameraStatus,
    });
    return () => this.listeners.delete(listener);
  }
}
