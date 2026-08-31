export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { initializeObservability } = await import("@content-automation/observability/node");
  await initializeObservability({
    serviceName: "taicho-content",
    serviceVersion: process.env.DD_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA,
  });
  const { compileKnowledgeRegistry, coreKnowledgeManifest, knowledgeRegistry } = await import(
    "@content-automation/knowledge"
  );
  const [{ contentKnowledgeManifest }, { outreachKnowledgeManifest }] = await Promise.all([
    import("@content-automation/content-generator/knowledge-manifest"),
    import("@content-automation/outreach/knowledge-manifest"),
  ]);
  knowledgeRegistry.install(compileKnowledgeRegistry([
    coreKnowledgeManifest,
    contentKnowledgeManifest,
    outreachKnowledgeManifest,
  ]));
  const { kickJobReconcilers, registerJobReconciler } = await import("@content-automation/platform/jobs/reconcilers");
  const { sweepCreativeGenerations } = await import("@content-automation/content-generator/media/service");
  registerJobReconciler("creative-media.sweep", () => sweepCreativeGenerations());
  const intervalMs = Math.max(15_000, Number(process.env.CREATIVE_MEDIA_RECONCILE_INTERVAL_MS) || 30_000);
  if (!globalThis.__creativeMediaReconcilerInterval) {
    globalThis.__creativeMediaReconcilerInterval = setInterval(() => kickJobReconcilers(), intervalMs);
    globalThis.__creativeMediaReconcilerInterval.unref?.();
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __creativeMediaReconcilerInterval: ReturnType<typeof setInterval> | undefined;
}
