function getSecret() {
  const secret = process.env.FIELD_ENCRYPTION_SECRET;
  if (!secret) throw new Error("FIELD_ENCRYPTION_SECRET is not set");
  return secret;
}

// Sprint 26: no `saltGenerator` — the library defaults to a fresh
// crypto.randomBytes(16) IV per encryption. The previous
// `saltGenerator: (secret) => secret.slice(0, 16)` made ONE constant IV for
// every field of every record, so identical plaintexts produced identical
// ciphertexts (leaking which records share a name/address/diagnosis).
//
// Removing it is backward-compatible with existing data: the plugin stores
// values as "<iv-hex>:<ciphertext-hex>" and decrypt reads the IV back from
// the stored value itself (lib/mongoose-field-encryption.js, decrypt()),
// never from this config. Legacy rows keep decrypting; new writes get random
// IVs; scripts/reencryptFieldIVs.ts re-randomizes legacy rows.
//
// The ONLY change that would make existing records undecryptable is changing
// FIELD_ENCRYPTION_SECRET — never do that.
export const fieldEncryptionOptions = (fields: string[]) => ({
  fields,
  secret: getSecret,
});
