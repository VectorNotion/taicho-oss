export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { initializeObservability } = await import("@content-automation/observability/node");
  await initializeObservability({
    serviceName: "taicho-content",
    serviceVersion: process.env.DD_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA,
  });
  const { registerJobReconciler } = await import("@content-automation/platform/jobs/reconcilers");
  const { sweepCreativeGenerations } = await import("@content-automation/content-generator/media/service");
  registerJobReconciler("creative-media.sweep", () => sweepCreativeGenerations());
}
