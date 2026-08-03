import { createHash, createHmac } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function digest(value: string): Buffer {
  const key = process.env.OBSERVABILITY_ID_HASH_KEY;
  return key
    ? createHmac("sha256", key).update(`support:${value}`).digest()
    : createHash("sha256").update(`taicho-support:${value}`).digest();
}

/** Stable, opaque, human-readable code derived from the root request identity. */
export function supportCodeFor(requestId: string): string {
  const bytes = digest(requestId);
  let bits = 0;
  let bitCount = 0;
  let encoded = "";
  for (const byte of bytes) {
    bits = (bits << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5 && encoded.length < 10) {
      encoded += CROCKFORD[(bits >>> (bitCount - 5)) & 31];
      bitCount -= 5;
    }
    if (encoded.length === 10) break;
  }
  return `TX-${encoded.slice(0, 5)}-${encoded.slice(5, 10)}`;
}
