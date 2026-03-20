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

/**
 * Card draw probability weights per question category (RULES.md §Cards).
 *
 * Each entry is a { time_bonus, powerup, curse } triple whose values sum to 1.0.
 *
 * Design rationale:
 *   photo      — answering requires the hider to send a photo (high effort)
 *                → reward with more time_bonus probability
 *   tentacle   — adversarial mechanic that checks proximity
 *                → skewed toward curse to reflect the threatening nature
 *   matching / measuring / transit / thermometer — balanced draws
 */
export const CARD_DRAW_WEIGHTS = Object.freeze({
  matching:    Object.freeze({ time_bonus: 0.40, powerup: 0.35, curse: 0.25 }),
  measuring:   Object.freeze({ time_bonus: 0.35, powerup: 0.35, curse: 0.30 }),
  transit:     Object.freeze({ time_bonus: 0.35, powerup: 0.35, curse: 0.30 }),
  photo:       Object.freeze({ time_bonus: 0.55, powerup: 0.30, curse: 0.15 }),
  thermometer: Object.freeze({ time_bonus: 0.35, powerup: 0.35, curse: 0.30 }),
  tentacle:    Object.freeze({ time_bonus: 0.25, powerup: 0.30, curse: 0.45 }),
});

/**
 * Equal-probability fallback used when questionCategory is omitted or unrecognised.
 * Each card type has a 1/3 probability.
 */
export const CARD_DRAW_WEIGHTS_DEFAULT = Object.freeze({
  time_bonus: 1 / 3,
  powerup:    1 / 3,
  curse:      1 / 3,
});
