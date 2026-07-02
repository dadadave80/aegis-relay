/**
 * dashboard/lib/geo.ts
 *
 * Inverse of the geocell Morton mapping (circuits/lib/geocell.circom,
 * DESIGN §5.4) — decodes a resolution-r cell id back to its lat/lon box
 * so the corridor cover can be rendered as an SVG grid.
 *
 * Normative forward mapping (verified against the lane-7 fixture:
 * encode(waypoint 0) == origin_cell 807503778):
 *
 *   lat_q = floor((lat + 90) / 180 · 2^24)   — 24-bit
 *   lon_q = floor((lon + 180) / 360 · 2^24)  — 24-bit
 *   cell  = Morton-interleave of the top r bits of each, lat bits in the
 *           ODD (higher) positions, lon bits in the EVEN positions.
 */

export const Q_BITS = 24;
export const RC_RES = 15; // corridor cells  (~611 m × 1.22 km at the equator)
export const RD_RES = 17; // dest-region cells (~153 m × 305 m)

export function latQToDeg(latQ: number): number {
  return (latQ / 2 ** Q_BITS) * 180 - 90;
}

export function lonQToDeg(lonQ: number): number {
  return (lonQ / 2 ** Q_BITS) * 360 - 180;
}

export interface CellBox {
  cell: string;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

/**
 * Decode a resolution-r Morton cell id into its lat/lon bounding box
 * (degrees). De-interleaves even bits → lon_top, odd bits → lat_top; the
 * box spans one 2^(24−r) quantization step in each axis.
 */
export function decodeCell(cellId: string | number | bigint, r: number): CellBox {
  const cell = BigInt(cellId);
  let latTop = 0n;
  let lonTop = 0n;
  for (let j = 0n; j < BigInt(r); j++) {
    lonTop |= ((cell >> (2n * j)) & 1n) << j;
    latTop |= ((cell >> (2n * j + 1n)) & 1n) << j;
  }
  const step = 1 << (Q_BITS - r);
  const latQ = Number(latTop) * step;
  const lonQ = Number(lonTop) * step;
  return {
    cell: cell.toString(),
    latMin: latQToDeg(latQ),
    latMax: latQToDeg(latQ + step),
    lonMin: lonQToDeg(lonQ),
    lonMax: lonQToDeg(lonQ + step),
  };
}

export interface GeoBounds {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

/** Union bounding box of cell boxes and waypoints, padded by `pad` (fraction). */
export function bounds(
  boxes: CellBox[],
  points: Array<{ lat: number; lon: number }>,
  pad = 0.08,
): GeoBounds {
  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
  for (const b of boxes) {
    latMin = Math.min(latMin, b.latMin);
    latMax = Math.max(latMax, b.latMax);
    lonMin = Math.min(lonMin, b.lonMin);
    lonMax = Math.max(lonMax, b.lonMax);
  }
  for (const p of points) {
    latMin = Math.min(latMin, p.lat);
    latMax = Math.max(latMax, p.lat);
    lonMin = Math.min(lonMin, p.lon);
    lonMax = Math.max(lonMax, p.lon);
  }
  const latPad = (latMax - latMin) * pad;
  const lonPad = (lonMax - lonMin) * pad;
  return {
    latMin: latMin - latPad,
    latMax: latMax + latPad,
    lonMin: lonMin - lonPad,
    lonMax: lonMax + lonPad,
  };
}

/**
 * Equirectangular projector into an SVG viewport. At lane-7's latitude the
 * degree aspect is metrically honest to within ~1% — no fancy projection
 * needed for a corridor a few kilometres long.
 */
export function projector(b: GeoBounds, width: number, height: number) {
  const dLon = b.lonMax - b.lonMin;
  const dLat = b.latMax - b.latMin;
  return {
    x: (lon: number) => ((lon - b.lonMin) / dLon) * width,
    y: (lat: number) => ((b.latMax - lat) / dLat) * height,
  };
}
