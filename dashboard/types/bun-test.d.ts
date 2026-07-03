// Minimal ambient surface so `tsc --noEmit` resolves the `bun:test` imports in
// *.test.ts (tsconfig `include` is **/*.ts). Bun runs the tests; this only
// satisfies the type-checker. Shared across all pure-logic test tasks.
declare module "bun:test" {
  export const test: (name: string, fn: () => unknown | Promise<unknown>) => void;
  export const expect: (value: unknown) => {
    toBe(v: unknown): void;
    toEqual(v: unknown): void;
    toBeInstanceOf(v: unknown): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toThrow(v?: unknown): void;
  };
}
