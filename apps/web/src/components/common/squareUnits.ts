/** Most squares one side of a comparison may draw before each square stands for more than one unit. */
export const MAX_SQUARES = 120;
const UNITS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000];

/** One unit per square when it fits, otherwise the smallest round number that keeps the larger side under the cap. */
export function unitFor(max: number): number {
  return UNITS.find(u => max / u <= MAX_SQUARES) ?? Math.ceil(max / MAX_SQUARES);
}
