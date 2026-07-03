// circomlibjs ships no types; minimal ambient surface for the PoD signer.
declare module "circomlibjs" {
  type FE = unknown; // opaque babyJub / poseidon field element
  interface F {
    e(x: bigint | number | string): FE;
    toString(x: FE): string;
    toObject(x: FE): bigint;
  }
  interface Poseidon {
    (inputs: Array<bigint | number | string | FE>): FE;
    F: F;
  }
  interface Eddsa {
    poseidon: Poseidon;
    babyJub: { F: F };
    prv2pub(prv: Uint8Array): [FE, FE];
    signPoseidon(prv: Uint8Array, msg: FE): { R8: [FE, FE]; S: bigint };
    verifyPoseidon(msg: FE, sig: { R8: [FE, FE]; S: bigint }, A: [FE, FE]): boolean;
  }
  export function buildEddsa(): Promise<Eddsa>;
  export function buildPoseidon(): Promise<Poseidon>;
}
