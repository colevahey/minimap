/** Average eye height above ground while holding a phone at chest/face level — used to
 * angle §8's height-occlusion test and to project a building's roofline in AR. */
export const EYE_HEIGHT_M = 1.6;

/** Typical story height, used to estimate a building's height from its floor count
 * when no direct height_m measurement exists (and, doubling as a flat single-story
 * placeholder, when neither is known). */
export const M_PER_FLOOR = 3.5;
