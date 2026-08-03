const defaultOpenApiUrl =
  process.env.NODE_ENV === "production"
    ? "https://cloud.taicho.ai/api/v1/openapi.json"
    : "http://localhost:3000/api/v1/openapi.json";

function openApiUrl() {
  const configured = process.env.DOCS_OPENAPI_URL?.trim();
  const url = new URL(configured || defaultOpenApiUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("DOCS_OPENAPI_URL must use HTTP or HTTPS.");
  }
  return url;
}

export async function GET() {
  try {
    const upstream = await fetch(openApiUrl(), {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
    });

    if (!upstream.ok) {
      return Response.json(
        { error: "The API contract is temporarily unavailable." },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    return new Response(await upstream.text(), {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch {
    return Response.json(
      { error: "The API contract is temporarily unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
