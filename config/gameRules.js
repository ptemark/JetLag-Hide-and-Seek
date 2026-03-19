/**
 * gameRules.js — Single source of truth for game-scale constants.
 *
 * Both `functions/games.js` and `server/index.js` previously defined these
 * independently.  Any change to scale values must be made here only.
 *
 * Sources: RULES.md §Game Scales
 */

/**
 * Valid hiding/seeking duration ranges per scale (RULES.md §Game Scales).
 * All values in minutes.
 */
export const SCALE_DURATION_RANGES = Object.freeze({
  small:  Object.freeze({ min: 30,  max: 60  }),
  medium: Object.freeze({ min: 60,  max: 180 }),
  large:  Object.freeze({ min: 180, max: 360 }),
});

/**
 * Default hiding and seeking phase durations per game scale (RULES.md).
 * Both hiding and seeking phases use the same duration for a given scale.
 * Values are in milliseconds.
 */
export const SCALE_DURATIONS = Object.freeze({
  small:  30  * 60_000,
  medium: 60  * 60_000,
  large:  180 * 60_000,
});
