/**
 * dashboard/lib/fixtures.ts
 *
 * Build-time import of the committed lane-7 flight fixtures. The /map page
 * is fully static — it renders the public corridor cover (what the chain
 * sees) and the fixture route (the carrier's private witness) without any
 * RPC dependency, so it always works.
 */

import corridorJson from "../../circuits/fixtures/flight/corridor.json";
import flightInput from "../../circuits/fixtures/flight/input.json";

export interface CorridorFixture {
  laneId: number;
  cells: string[];
  root: string;
}

export const corridorFixture: CorridorFixture = {
  laneId: (corridorJson as { lane_id: number }).lane_id,
  cells: (corridorJson as { cells: string[] }).cells,
  root: (corridorJson as { root: string }).root,
};

export interface Waypoint {
  latQ: number;
  lonQ: number;
  altDm: number;
  t: number;
}

const input = flightInput as unknown as {
  lat_q: string[];
  lon_q: string[];
  alt_dm: string[];
  t: string[];
  origin_cell: string;
};

export const routeWaypoints: Waypoint[] = input.lat_q.map((lat, i) => ({
  latQ: Number(lat),
  lonQ: Number(input.lon_q[i]),
  altDm: Number(input.alt_dm[i]),
  t: Number(input.t[i]),
}));

export const originCell: string = input.origin_cell;
