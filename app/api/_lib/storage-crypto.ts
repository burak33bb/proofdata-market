function fromBase64(value: string) {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

function toBase64(value: ArrayBuffer | Uint8Array) {
  return Buffer.from(value instanceof Uint8Array ? value : new Uint8Array(value)).toString(
    "base64",
  );
}

async function wrappingKey(secret: string, datasetId: string) {
  const material = new TextEncoder().encode(`proofdata:kek:v2:${secret}:${datasetId}`);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function wrapDatasetKey(
  keyBase64: string,
  datasetId: string,
  secret: string,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await wrappingKey(secret, datasetId);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    fromBase64(keyBase64),
  );
  return { iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
}

export async function unwrapDatasetKey(
  wrapped: { iv: string; ciphertext: string },
  datasetId: string,
  secret: string,
) {
  const key = await wrappingKey(secret, datasetId);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(wrapped.iv) },
    key,
    fromBase64(wrapped.ciphertext),
  );
  return toBase64(plaintext);
}
