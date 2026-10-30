let counter = 0;

/**
 * Request IDs for REST commands. They match the contract's ID pattern
 * (`[A-Za-z0-9][A-Za-z0-9_.:-]*`, 1–128 chars). A new user intent always gets
 * a new ID; retrying the same operation must reuse the original one.
 */
export function createRequestId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  const random = Math.floor(Math.random() * 0xffffff).toString(36);
  const safePrefix = prefix.replace(/[^A-Za-z0-9_.:-]/g, "-").replace(/^[^A-Za-z0-9]+/, "") || "req";
  return `${safePrefix}-${Date.now().toString(36)}-${counter.toString(36)}-${random}`.slice(0, 128);
}

/** Unsigned 32-bit seed. */
export function createSeed(): number {
  return Math.floor(Math.random() * 0xffff_ffff) >>> 0;
}
