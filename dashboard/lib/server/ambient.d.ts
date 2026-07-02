// Ambient declarations for the untyped crypto/proving packages the server
// reuses from the prover. circomlibjs and snarkjs ship no type declarations;
// the prover never strict-typechecks (it runs under a non-checking loader), but
// the dashboard build does, so the reused prover .ts files would otherwise fail
// with TS7016. These shorthand ambient modules type them as `any` — the same
// effective behavior the prover has. (Not a tsconfig change; not a build-error
// suppression — just the missing type stubs.)
declare module "circomlibjs";
declare module "snarkjs";
