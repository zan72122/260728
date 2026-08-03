// Deterministic RNG utilities — see docs/CONTRACTS.md.
// Owner: A (bootstrap).

// mulberry32: fast, small, deterministic PRNG.
// Returns a function that yields floats in [0, 1) on each call.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// hashInts: combine an arbitrary list of integers into a single uint32 seed.
// Deterministic across calls/platforms for the same inputs.
export function hashInts(...ints) {
  let h = 0x811c9dc5; // FNV-1a offset basis
  for (let i = 0; i < ints.length; i++) {
    // Coerce to a safe 32-bit integer contribution.
    let v = ints[i] | 0;
    h ^= v;
    h = Math.imul(h, 0x01000193); // FNV prime
    h >>>= 0;
  }
  return h >>> 0;
}
