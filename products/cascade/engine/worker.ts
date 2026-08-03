import { createLogger } from "@content-automation/observability";
import { databaseFor, enrollmentsInCascade, sendsInCascade } from "@content-automation/database";
import { and, eq, isNotNull, lte, lt, sql } from "drizzle-orm";
import {
  initializeObservability,
  shutdownObservability,
} from "@content-automation/observability/node";
import {
  closeCascadePools,
  getCascadeAdminPool,
  getCascadePool,
  schemaName,
} from "../data/pool";
import { ensureCascadeSchema } from "../data/schema";
import { resolveWorkspaceDeliveryRuntime } from "../delivery/runtime";
import { createCascadeHttpServer } from "./http";
import { runSendLoop } from "./send-loop";
import { runTick } from "./tick";

const intervalMs = Number(process.env.CASCADE_TICK_INTERVAL_MS ?? 1000);
const batchSize = Number(process.env.CASCADE_BATCH_SIZE ?? 10);
const httpPort = Number(process.env.CASCADE_HTTP_PORT ?? 3010);
const adminPool = getCascadeAdminPool();
const httpServer = createCascadeHttpServer({
  control: adminPool,
  forOrganization: getCascadePool,
  dashboard: process.env.NODE_ENV === "production" ? undefined : adminPool,
});
await ensureCascadeSchema(adminPool);
await initializeObservability({ serviceName: "taicho-cascade-worker" });
const log = createLogger("cascade.worker");
httpServer.listen(httpPort, () => {
  log.info("worker.http.listening", { port: httpPort });
});

let running = true;

function shutdown(signal: string) {
  log.info("worker.shutdown.requested", { signal });
  running = false;
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

log.info("worker.started", {
  interval_ms: intervalMs,
  batch_size: batchSize,
  database_schema: schemaName(),
});

while (running) {
  try {
    const adminDb = databaseFor(adminPool);
    const [dueEnrollments, queuedSends] = await Promise.all([
      adminDb
        .selectDistinct({ organizationId: enrollmentsInCascade.organization_id })
        .from(enrollmentsInCascade)
        .where(
          and(
            isNotNull(enrollmentsInCascade.organization_id),
            eq(enrollmentsInCascade.state, "active"),
            lte(enrollmentsInCascade.next_run_at, sql`now()`),
          ),
        ),
      adminDb
        .selectDistinct({ organizationId: sendsInCascade.organization_id })
        .from(sendsInCascade)
        .where(
          and(
            isNotNull(sendsInCascade.organization_id),
            eq(sendsInCascade.status, "queued"),
            lt(sendsInCascade.attempts, 5),
          ),
        ),
    ]);
    const organizations = new Set(
      [...dueEnrollments, ...queuedSends]
        .map((row) => row.organizationId)
        .filter((id): id is string => Boolean(id)),
    );
    for (const organizationId of organizations) {
      const pool = getCascadePool(organizationId);
      const res = await runTick(pool, { batchSize });
      if (res.processed > 0) {
        log.info("worker.enrollments.processed", { ...res });
      }
      const delivery = await resolveWorkspaceDeliveryRuntime(pool);
      const sent = await runSendLoop(pool, delivery.mailer, {
        batchSize,
        providerConnectionId: delivery.providerConnectionId,
        sender: delivery.sender,
      });
      if (sent.sent + sent.failed + sent.skipped > 0) {
        log.info("worker.sends.processed", { ...sent });
      }
    }
  } catch (err) {
    log.error("worker.tick.failed", err);
  }
  if (running) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

await new Promise<void>((resolve) => httpServer.close(() => resolve()));
await closeCascadePools();
await shutdownObservability();
