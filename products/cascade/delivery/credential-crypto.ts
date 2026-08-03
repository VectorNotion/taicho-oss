import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const ENVELOPE_VERSION = 1;

interface CredentialEnvelope {
  version: number;
  keyVersion: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

function decodeMasterKey(value: string): Buffer {
  const trimmed = value.trim();
  const key = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (key.length !== 32) {
    throw new Error(
      "CASCADE_CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes.",
    );
  }
  return key;
}

function environmentKeyName(keyVersion: string): string {
  return `CASCADE_CREDENTIAL_ENCRYPTION_KEY_${keyVersion
    .toUpperCase()
    .replaceAll("-", "_")}`;
}

function keyForVersion(keyVersion: string): Buffer {
  const configuredVersion =
    process.env.CASCADE_CREDENTIAL_ENCRYPTION_KEY_VERSION ?? "v1";
  const current = process.env.CASCADE_CREDENTIAL_ENCRYPTION_KEY;
  const historical = process.env[environmentKeyName(keyVersion)];
  if (keyVersion === configuredVersion && current) {
    return decodeMasterKey(current);
  }
  if (historical) return decodeMasterKey(historical);
  if (process.env.NODE_ENV !== "production") {
    return createHash("sha256")
      .update(
        process.env.BETTER_AUTH_SECRET
          ?? "local-cascade-delivery-development-key",
      )
      .digest();
  }
  throw new Error(
    `No Nurture delivery credential encryption key is configured for ${keyVersion}.`,
  );
}

function encode(envelope: CredentialEnvelope): string {
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
}

function decode(value: string): CredentialEnvelope {
  const parsed = JSON.parse(
    Buffer.from(value, "base64url").toString("utf8"),
  ) as CredentialEnvelope;
  if (
    parsed.version !== ENVELOPE_VERSION
    || typeof parsed.keyVersion !== "string"
    || typeof parsed.iv !== "string"
    || typeof parsed.tag !== "string"
    || typeof parsed.ciphertext !== "string"
  ) {
    throw new Error("Unsupported encrypted Nurture delivery credential.");
  }
  return parsed;
}

export function deliveryCredentialAssociatedData(input: {
  organizationId: string;
  providerConnectionId: string;
}): string {
  return `${input.organizationId}:${input.providerConnectionId}:delivery-credentials`;
}

export function encryptDeliveryCredentials(
  value: unknown,
  associatedData: string,
  keyVersion =
    process.env.CASCADE_CREDENTIAL_ENCRYPTION_KEY_VERSION ?? "v1",
): { ciphertext: string; keyVersion: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, keyForVersion(keyVersion), iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    keyVersion,
    ciphertext: encode({
      version: ENVELOPE_VERSION,
      keyVersion,
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    }),
  };
}

export function decryptDeliveryCredentials<T>(
  value: string,
  associatedData: string,
): T {
  const envelope = decode(value);
  const decipher = createDecipheriv(
    ALGORITHM,
    keyForVersion(envelope.keyVersion),
    Buffer.from(envelope.iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
