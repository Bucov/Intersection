/**
 * Seeded random streams for the offline demo engine.
 *
 * Each concern (demand, vehicle mix, model latency...) draws from its own
 * stream so that controller decisions can never shift the demand schedule:
 * a traditional and an AI session with the same seed see the same arrivals.
 */

function hashString(input: string): number {
  // FNV-1a, 32 bit.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface RandomStream {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Poisson-distributed count with the given mean (Knuth; fine for small means). */
  poisson(mean: number): number;
}

export function createStream(seed: number, name: string): RandomStream {
  // sfc32 seeded from the session seed and the stream name.
  let a = hashString(`${seed}:${name}:a`);
  let b = hashString(`${seed}:${name}:b`);
  let c = hashString(`${seed}:${name}:c`);
  let d = 1;
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const result = (t + d) | 0;
    c = (c + result) | 0;
    return (result >>> 0) / 4294967296;
  };
  // Discard the first outputs; sfc32 needs a few rounds to mix.
  for (let i = 0; i < 12; i++) next();

  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    poisson(mean) {
      if (mean <= 0) return 0;
      const limit = Math.exp(-mean);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= next();
      } while (p > limit);
      return k - 1;
    },
  };
}
