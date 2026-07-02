// Convert a snarkjs verification_key.json into the stellar-cli JSON argument
// for aegis-registry's VerificationKey contracttype (BytesN fields as hex).
// Encoding per prover/src/lib/bn254.ts: G1 = BE32(x)||BE32(y);
// G2 = BE32(x_c1)||BE32(x_c0)||BE32(y_c1)||BE32(y_c0) — imaginary limb first.
import { readFileSync } from "fs";

function toBE32(dec) {
  let n = BigInt(dec);
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) { out[i] = Number(n & 0xffn); n >>= 8n; }
  if (n !== 0n) throw new Error("overflow");
  return out;
}
const hex = (arrs) => arrs.map(a => [...a].map(b => b.toString(16).padStart(2, "0")).join("")).join("");
const g1 = (p) => hex([toBE32(p[0]), toBE32(p[1])]);
const g2 = (p) => hex([toBE32(p[0][1]), toBE32(p[0][0]), toBE32(p[1][1]), toBE32(p[1][0])]);

const vk = JSON.parse(readFileSync(process.argv[2], "utf8"));
console.log(JSON.stringify({
  alpha: g1(vk.vk_alpha_1),
  beta: g2(vk.vk_beta_2),
  gamma: g2(vk.vk_gamma_2),
  delta: g2(vk.vk_delta_2),
  ic: vk.IC.map(g1),
}));
