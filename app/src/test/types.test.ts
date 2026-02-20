import test from "node:test";
import assert from "node:assert/strict";

import { normalizeVariants } from "../types";

test("normalizeVariants enforces lowercase uniqueness and includes wake word", () => {
  const variants = normalizeVariants("Faye Arise", ["Faye Arise", "faye arise", "FATE ARISE"]);
  assert.deepEqual(variants, ["faye arise", "fate arise"]);
});

