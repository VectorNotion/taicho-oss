export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { initializeObservability } = await import("@content-automation/observability/node");
  await initializeObservability({
    serviceName: "taicho-outreach",
    serviceVersion: process.env.DD_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA,
  });
}
