import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash, randomUUID } from "node:crypto";

/**
 * Cloudflare R2 media staging (S3-compatible), ported from Relay.
 * Env names are kept identical to Relay's so existing credentials work as-is.
 */
export interface R2Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Public base URL for the bucket (required for URL-mode destinations like Instagram). */
  publicUrl?: string;
}

export function r2ConfigFromEnv(): R2Config | null {
  const endpoint = process.env.RELAY_R2_ENDPOINT;
  const accessKeyId = process.env.RELAY_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.RELAY_R2_SECRET_ACCESS_KEY;
  const bucket = process.env.RELAY_R2_BUCKET;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { endpoint, accessKeyId, secretAccessKey, bucket, publicUrl: process.env.RELAY_R2_PUBLIC_URL };
}

export class R2Media {
  private client: S3Client;

  constructor(private config: R2Config) {
    this.client = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  static fromEnv(): R2Media | null {
    const config = r2ConfigFromEnv();
    return config ? new R2Media(config) : null;
  }

  /** Stage media bytes; returns the object key ("media/<uuid>/<name>") used as posts.media_key. */
  async put(name: string, bytes: Buffer, contentType?: string): Promise<string> {
    const key = `media/${randomUUID()}/${name}`;
    await this.client.send(
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: bytes, ContentType: contentType }),
    );
    return key;
  }

  /** Stage tenant-owned media under an opaque organization namespace. */
  async putForOrganization(organizationId: string, name: string, bytes: Buffer, contentType?: string): Promise<string> {
    const namespace = createHash("sha256").update(organizationId).digest("hex").slice(0, 24);
    const key = `media/org-${namespace}/${randomUUID()}/${name}`;
    await this.client.send(
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: bytes, ContentType: contentType }),
    );
    return key;
  }

  /** Idempotent object location for replay-safe provider result ingestion. */
  async putGeneratedForOrganization(
    organizationId: string,
    generationRunId: string,
    outputIndex: number,
    name: string,
    bytes: Buffer,
    contentType?: string,
  ): Promise<string> {
    if (!/^[a-f0-9-]{36}$/i.test(generationRunId) || !Number.isSafeInteger(outputIndex) || outputIndex < 0) {
      throw new Error("Invalid generated media object identity.");
    }
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-160) || "asset";
    const namespace = createHash("sha256").update(organizationId).digest("hex").slice(0, 24);
    const key = `media/org-${namespace}/generated/${generationRunId}/${outputIndex}-${safeName}`;
    await this.client.send(
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: bytes, ContentType: contentType }),
    );
    return key;
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error(`R2 object ${key} has no body`);
    return Buffer.from(bytes);
  }

  publicUrlFor(key: string): string {
    if (!this.config.publicUrl) throw new Error("RELAY_R2_PUBLIC_URL is not configured (required for URL-mode destinations)");
    return `${this.config.publicUrl.replace(/\/$/, "")}/${key}`;
  }
}

export function isR2Key(mediaKey: string): boolean {
  return mediaKey.startsWith("media/");
}
