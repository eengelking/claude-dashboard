// How many columns the fleet wall uses (#145): as many 360 px cards, 12 px apart, as fit in the wall's own width,
// never more than four and never more columns than cards. The cards then stretch to fill the row. A lone card is
// half the wall when two columns fit, and the full width when they do not.
export const CARD_MIN = 360;
export const WALL_GAP = 12;
export const MAX_COLS = 4;

/** Columns for a wall `width` px wide showing `count` cards in total (every band shares the same columns). */
export function wallColumns(width: number, count: number): number {
  const fit = Math.max(1, Math.min(MAX_COLS, Math.floor((width + WALL_GAP) / (CARD_MIN + WALL_GAP))));
  if (count <= 0) return 1;
  if (count === 1) return fit >= 2 ? 2 : 1;
  return Math.min(fit, count);
}
