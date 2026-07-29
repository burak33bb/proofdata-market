import test from "node:test";
import assert from "node:assert/strict";
import {
  unwrapDatasetKey,
  wrapDatasetKey,
} from "../app/api/_lib/storage-crypto.ts";

test("wraps and unwraps a 256-bit dataset key for the same listing", async () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const keyBase64 = Buffer.from(key).toString("base64");
  const wrapped = await wrapDatasetKey(keyBase64, "dataset-1", "server-secret");
  assert.notEqual(wrapped.ciphertext, keyBase64);
  assert.equal(
    await unwrapDatasetKey(wrapped, "dataset-1", "server-secret"),
    keyBase64,
  );
});

test("does not unwrap a key for another listing", async () => {
  const keyBase64 = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "base64",
  );
  const wrapped = await wrapDatasetKey(keyBase64, "dataset-1", "server-secret");
  await assert.rejects(() =>
    unwrapDatasetKey(wrapped, "dataset-2", "server-secret"),
  );
});
