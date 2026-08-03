import fs from "node:fs/promises";
import path from "node:path";
import { contentDirectory } from "@/lib/docs";

const contentTypes: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  if (!/^[A-Za-z0-9._-]+$/.test(filename)) {
    return new Response("Not found", { status: 404 });
  }

  const extension = path.extname(filename).toLowerCase();
  const contentType = contentTypes[extension];
  if (!contentType) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const image = await fs.readFile(
      path.join(contentDirectory, "images", filename),
    );
    return new Response(image, {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=31536000, immutable",
        "Content-Type": contentType,
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
