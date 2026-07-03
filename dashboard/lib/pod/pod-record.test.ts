import { test, expect } from "bun:test";
import { podRecord, type PodEnvelope } from "./pod-record";

const sig: PodEnvelope = { R8: ["111", "222"], S: "333", ts: 1751500000 };

test("podRecord maps a browser signature + quantized coords to the Pod shape", () => {
  const pod = podRecord(sig, 8461234n, 16777000n);
  expect(pod).toEqual({
    R8x: "111",
    R8y: "222",
    S: "333",
    ts: "1751500000",
    lat_q: "8461234",
    lon_q: "16777000",
  });
});

test("podRecord stringifies a numeric or string ts consistently", () => {
  expect(podRecord({ ...sig, ts: "1751500000" }, 1, 2).ts).toBe("1751500000");
  expect(podRecord({ ...sig, ts: 42 }, 1, 2).ts).toBe("42");
});

test("podRecord rejects a malformed R8", () => {
  // @ts-expect-error — R8 must be a 2-tuple
  expect(() => podRecord({ R8: ["x"], S: "1", ts: 1 }, 1, 2)).toThrow("R8 must be [x, y]");
});

test("podRecord rejects an empty S", () => {
  expect(() => podRecord({ R8: ["1", "2"], S: "", ts: 1 }, 1, 2)).toThrow("S (decimal string) required");
});
