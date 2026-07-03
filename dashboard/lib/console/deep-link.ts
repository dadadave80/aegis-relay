/**
 * Pure helpers for the console's marketplace deep-links (Task 11). No DOM/React
 * imports so they unit-test under bun:test. Used by Console.tsx (honor
 * `?claimed=<id>`) and the Merchant panel (absolutize the recipient claim link).
 */

/** Parse `?claimed=<id>` into a shipment id, or null. Search string may include
 *  a leading "?". Only non-negative safe integers are accepted. */
export function parseClaimedId(search: string): number | null {
  const q = search.startsWith("?") ? search.slice(1) : search;
  const raw = new URLSearchParams(q).get("claimed");
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/** Turn a server-returned claim link (a `/claim/<id>` PATH, or an
 *  already-absolute URL) into an absolute, shareable URL against `origin`. */
export function claimUrl(origin: string, claimLink: string): string {
  if (/^https?:\/\//i.test(claimLink)) return claimLink;
  const base = origin.replace(/\/+$/, "");
  const path = claimLink.startsWith("/") ? claimLink : `/${claimLink}`;
  return `${base}${path}`;
}
