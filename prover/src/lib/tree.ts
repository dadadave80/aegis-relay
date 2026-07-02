/**
 * tree.ts — Build a binary Poseidon-Merkle tree for N=16.
 *
 * Convention (mirrors por.circom):
 *   leaf[i] = poseidon([balance, salt])
 *   Pad to 16 leaves with poseidon([0, 0])
 *   even-indexed node = left child
 *   parent[j/2] = poseidon(nodes[j], nodes[j+1])   (j even, within a level)
 *   root = nodes[2*N - 2] = nodes[30]
 */

import { buildPoseidon } from 'circomlibjs';

export interface Entry {
  id: string;
  balance: bigint;
  salt: bigint;
}

export interface PathEntry {
  index: number;
  leaf: bigint;
  /** Sibling hashes from leaf level up to (but not including) root, depth-first */
  path: bigint[];
}

export interface TreeResult {
  root: bigint;
  total: bigint;
  leaves: bigint[];
  /** paths[i] is the inclusion path for entries[i] */
  paths: PathEntry[];
  /** full node array (2N=32 entries; nodes[30] = root) */
  nodes: bigint[];
}

const N = 16;
const LEVELS = 4; // log2(16)

/**
 * Build the Poseidon tree and compute all inclusion paths.
 * At most N=16 entries; excess entries are silently truncated.
 */
export async function buildTree(entries: Entry[]): Promise<TreeResult> {
  const poseidon = await buildPoseidon();

  const field = poseidon.F;

  /** Convert a circomlibjs poseidon output to bigint */
  function hashToBigInt(h: Uint8Array): bigint {
    return BigInt(field.toString(h));
  }

  /** Poseidon(a, b) → bigint */
  function hash2(a: bigint, b: bigint): bigint {
    return hashToBigInt(poseidon([a, b]));
  }

  // ── 1. Compute leaf hashes ────────────────────────────────────────────────
  const used = Math.min(entries.length, N);
  const zeroLeaf = hash2(0n, 0n);

  const leaves: bigint[] = [];
  let total = 0n;

  for (let i = 0; i < N; i++) {
    if (i < used) {
      total += entries[i].balance;
      leaves.push(hash2(entries[i].balance, entries[i].salt));
    } else {
      leaves.push(zeroLeaf);
    }
  }

  // ── 2. Build the tree level by level ─────────────────────────────────────
  // nodes[0..N-1]   = leaves
  // nodes[N..N+N/2-1] = level-1 parents
  // …
  // nodes[2*N-2]    = root
  const nodes: bigint[] = [...leaves];

  let inStart = 0;
  let width = N;

  for (let l = 0; l < LEVELS; l++) {
    for (let j = 0; j < width; j += 2) {
      nodes.push(hash2(nodes[inStart + j], nodes[inStart + j + 1]));
    }
    inStart += width;
    width = width >> 1;
  }

  const root = nodes[2 * N - 2]; // nodes[30]

  // ── 3. Compute inclusion paths ────────────────────────────────────────────
  const paths: PathEntry[] = entries.slice(0, used).map((_, i) => {
    const path: bigint[] = [];
    let idx = i;
    let levelStart = 0;
    let levelWidth = N;

    for (let l = 0; l < LEVELS; l++) {
      const sibIdx = idx ^ 1; // toggle lowest bit = sibling
      path.push(nodes[levelStart + sibIdx]);
      idx = idx >> 1;
      levelStart += levelWidth;
      levelWidth = levelWidth >> 1;
    }

    return { index: i, leaf: leaves[i], path };
  });

  return { root, total, leaves, paths, nodes };
}
