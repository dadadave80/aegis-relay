/**
 * Lane-7 corridor fixture — the committed public corridor cover
 * (circuits/fixtures/flight/corridor.json) and the sample flight waypoints.
 * Cells are r=15 Morton ids; waypoints are 24-bit quantized lat/lon. PUBLIC BY
 * DESIGN. (Ported from the Aegis Relay Design System.)
 */
export const LANE7 = {
  laneId: 7,
  root: "7618840047666930958205792779173092022561051483539161335081185149304199723005",
  destRegionRoot: "10059808580053389120516785277308699267208074134301792388498249912507908406879",
  cells: [
    "807503605", "807503607", "807503613", "807503776", "807503777",
    "807503778", "807503779", "807503780", "807503782", "807503784",
    "807503785", "807503786", "807503787", "807503788", "807503790",
    "807503791", "807505152", "807505153", "807505155", "807505156",
    "807505157", "807505158", "807505159", "807505161", "807505163",
    "807505164", "807505165", "807505166", "807505167", "807505170",
    "807505176", "807505178", "807505188", "807505189", "807505200",
  ],
  waypoints: [
    { latQ: 8993519, lonQ: 8544729 }, { latQ: 8993733, lonQ: 8544820 },
    { latQ: 8993947, lonQ: 8544910 }, { latQ: 8994160, lonQ: 8545001 },
    { latQ: 8994374, lonQ: 8545092 }, { latQ: 8994588, lonQ: 8545183 },
    { latQ: 8994802, lonQ: 8545273 }, { latQ: 8995016, lonQ: 8545364 },
    { latQ: 8995229, lonQ: 8545455 }, { latQ: 8995443, lonQ: 8545546 },
    { latQ: 8995657, lonQ: 8545636 }, { latQ: 8995871, lonQ: 8545727 },
    { latQ: 8996085, lonQ: 8545818 }, { latQ: 8996298, lonQ: 8545909 },
    { latQ: 8996512, lonQ: 8545999 }, { latQ: 8996726, lonQ: 8546090 },
  ],
};

const Q_BITS = 24;
export const RC_RES = 15;

export function latQToDeg(latQ: number): number { return (latQ / 2 ** Q_BITS) * 180 - 90; }
export function lonQToDeg(lonQ: number): number { return (lonQ / 2 ** Q_BITS) * 360 - 180; }

export interface CellBox { cell: string; latMin: number; latMax: number; lonMin: number; lonMax: number; }
export interface GeoPoint { lat: number; lon: number; }
export interface GeoBounds { latMin: number; latMax: number; lonMin: number; lonMax: number; }

/** Decode a resolution-r Morton cell id into its lat/lon bounding box. */
export function decodeCell(cellId: string, r: number): CellBox {
  const cell = BigInt(cellId);
  let latTop = 0n, lonTop = 0n;
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

export function geoBounds(boxes: CellBox[], points: GeoPoint[], pad = 0.08): GeoBounds {
  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
  for (const b of boxes) {
    latMin = Math.min(latMin, b.latMin); latMax = Math.max(latMax, b.latMax);
    lonMin = Math.min(lonMin, b.lonMin); lonMax = Math.max(lonMax, b.lonMax);
  }
  for (const p of points) {
    latMin = Math.min(latMin, p.lat); latMax = Math.max(latMax, p.lat);
    lonMin = Math.min(lonMin, p.lon); lonMax = Math.max(lonMax, p.lon);
  }
  const latPad = (latMax - latMin) * pad, lonPad = (lonMax - lonMin) * pad;
  return { latMin: latMin - latPad, latMax: latMax + latPad, lonMin: lonMin - lonPad, lonMax: lonMax + lonPad };
}

export function projector(b: GeoBounds, width: number, height: number) {
  const dLon = b.lonMax - b.lonMin, dLat = b.latMax - b.latMin;
  return {
    x: (lon: number) => ((lon - b.lonMin) / dLon) * width,
    y: (lat: number) => ((b.latMax - lat) / dLat) * height,
  };
}
