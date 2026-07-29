import test from "node:test";
import assert from "node:assert/strict";
import {
  AnyPublicKey,
  AnySignature,
  Ed25519PrivateKey,
} from "@aptos-labs/ts-sdk";
import { verifyWalletProof } from "../app/api/_lib/wallet-proof.ts";

function makeProof(wrappedSignature: boolean, exposeInnerKey = false) {
  const privateKey = Ed25519PrivateKey.generate();
  const innerPublicKey = privateKey.publicKey();
  const publicKey = new AnyPublicKey(innerPublicKey);
  const message = "proofdata:listings:update:v1:dataset:{\"price\":2}";
  const nonce = `${Date.now()}:test`;
  const fullMessage = `APTOS\nmessage: ${message}\nnonce: ${nonce}`;
  const rawSignature = privateKey.sign(new TextEncoder().encode(fullMessage));
  const signature = wrappedSignature ? new AnySignature(rawSignature) : rawSignature;

  return {
    address: publicKey.authKey().derivedAddress().toStringLong(),
    message,
    proof: {
      address: publicKey.authKey().derivedAddress().toStringLong(),
      publicKey: (exposeInnerKey ? innerPublicKey : publicKey).toString(),
      publicKeyBcs: (exposeInnerKey ? innerPublicKey : publicKey).bcsToHex().toString(),
      publicKeyType: exposeInnerKey ? "Ed25519PublicKey" : "AnyPublicKey",
      fullMessage,
      message,
      nonce,
      signature: rawSignature.toString(),
      signatureBcs: signature.bcsToHex().toString(),
    },
  };
}

test("accepts Petra SingleKey proof with a raw Ed25519 message signature", () => {
  const fixture = makeProof(false);
  assert.equal(
    verifyWalletProof(fixture.proof, fixture.address, fixture.message),
    true,
  );
});

test("accepts Petra SingleKey proof with a wrapped AnySignature", () => {
  const fixture = makeProof(true);
  assert.equal(
    verifyWalletProof(fixture.proof, fixture.address, fixture.message),
    true,
  );
});

test("accepts Petra SingleKey address when Petra exposes its inner Ed25519 key", () => {
  const fixture = makeProof(false, true);
  assert.equal(
    verifyWalletProof(fixture.proof, fixture.address, fixture.message),
    true,
  );
});

test("rejects a proof for a different listing owner", () => {
  const fixture = makeProof(false);
  assert.equal(
    verifyWalletProof(fixture.proof, "0x1", fixture.message),
    false,
  );
});
