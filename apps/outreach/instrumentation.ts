export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { initializeObservability } = await import("@content-automation/observability/node");
  await initializeObservability({
    serviceName: "taicho-outreach",
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
}
