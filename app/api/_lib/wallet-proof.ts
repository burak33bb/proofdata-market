import {
  AnyPublicKey,
  AnySignature,
  Deserializer,
  Ed25519PublicKey,
  Ed25519Signature,
  Hex,
} from "@aptos-labs/ts-sdk";

export type WalletProof = {
  address: string;
  publicKey: string;
  publicKeyBcs?: string;
  publicKeyType?: string;
  fullMessage: string;
  message: string;
  nonce: string;
  signature: string;
  signatureBcs?: string;
};

export function canonicalAddress(value: string) {
  const clean = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{1,64}$/.test(clean)) return null;
  return `0x${clean.slice(2).padStart(64, "0")}`;
}

export function verifyWalletProof(
  value: unknown,
  expectedAddress: string,
  expectedMessage: string,
) {
  if (!value || typeof value !== "object") return false;
  const proof = value as Partial<WalletProof>;
  if (
    typeof proof.address !== "string" ||
    typeof proof.publicKey !== "string" ||
    typeof proof.fullMessage !== "string" ||
    typeof proof.message !== "string" ||
    typeof proof.nonce !== "string" ||
    typeof proof.signature !== "string"
  ) {
    return false;
  }
  if (proof.message !== expectedMessage) return false;
  if (!proof.fullMessage.includes(expectedMessage) || !proof.fullMessage.includes(proof.nonce)) {
    return false;
  }
  const timestamp = Number(proof.nonce.split(":")[0]);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) {
    return false;
  }

  try {
    if (canonicalAddress(proof.address) !== canonicalAddress(expectedAddress)) return false;

    const message = new TextEncoder().encode(proof.fullMessage);

    // Different Petra releases expose the same key through different wallet
    // standard wrappers. Decode the serialized value by its actual shape
    // instead of trusting a browser-side class name.
    const publicKeys: Array<AnyPublicKey | Ed25519PublicKey> = [];
    if (proof.publicKeyBcs) {
      const publicKeyBytes = Hex.fromHexInput(proof.publicKeyBcs).toUint8Array();
      try {
        if (publicKeyBytes.length === Ed25519PublicKey.LENGTH) {
          const ed25519Key = Ed25519PublicKey.deserialize(
            new Deserializer(publicKeyBytes),
          );
          // Some Petra versions expose the inner Ed25519 key even when the
          // account address uses Aptos' newer SingleKey authentication scheme.
          publicKeys.push(ed25519Key, new AnyPublicKey(ed25519Key));
        } else {
          publicKeys.push(AnyPublicKey.deserialize(new Deserializer(publicKeyBytes)));
        }
      } catch {
        // The string representation below is the legacy-wallet fallback.
      }
    }
    try {
      const ed25519Key = new Ed25519PublicKey(proof.publicKey);
      publicKeys.push(ed25519Key, new AnyPublicKey(ed25519Key));
    } catch {
      // Unified keys are already covered by their BCS representation.
    }

    const expected = canonicalAddress(expectedAddress);
    for (const publicKey of publicKeys) {
      if (canonicalAddress(publicKey.authKey().derivedAddress().toStringLong()) !== expected) {
        continue;
      }

      if (publicKey instanceof AnyPublicKey && proof.signatureBcs) {
        const signatureBytes = Hex.fromHexInput(proof.signatureBcs).toUint8Array();
        const signatures: AnySignature[] = [];
        try {
          signatures.push(AnySignature.deserialize(new Deserializer(signatureBytes)));
        } catch {
          // Try Petra's raw Ed25519 signature representation next.
        }
        try {
          signatures.push(
            new AnySignature(
              Ed25519Signature.deserialize(new Deserializer(signatureBytes)),
            ),
          );
        } catch {
          // A non-Ed25519 AnySignature was handled above.
        }
        if (signatures.some((signature) => publicKey.verifySignature({ message, signature }))) {
          return true;
        }
      }

      if (publicKey instanceof Ed25519PublicKey) {
        const signatures: Ed25519Signature[] = [];
        if (proof.signatureBcs) {
          try {
            signatures.push(
              Ed25519Signature.deserialize(
                new Deserializer(Hex.fromHexInput(proof.signatureBcs).toUint8Array()),
              ),
            );
          } catch {
            // Fall back to the standard hex form below.
          }
        }
        try {
          signatures.push(new Ed25519Signature(proof.signature));
        } catch {
          // Invalid signature input.
        }
        if (signatures.some((signature) => publicKey.verifySignature({ message, signature }))) {
          return true;
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}
