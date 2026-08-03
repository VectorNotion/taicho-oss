import { FalkorDB } from "falkordb";
import { organizationGraphName } from "../data/organization-context";

const organizationId = process.env.LEGACY_ORGANIZATION_ID;
if (!organizationId) throw new Error("LEGACY_ORGANIZATION_ID is required.");
if (process.env.MIGRATION_CONFIRM_COPY !== "yes") throw new Error("Set MIGRATION_CONFIRM_COPY=yes after verifying the target organization.");

const source = process.env.FALKORDB_GRAPH ?? "content";
const target = organizationGraphName(organizationId, source);
if (source === target) throw new Error("Legacy source and organization graph names unexpectedly match.");

const url = new URL(process.env.FALKORDB_URL ?? "redis://localhost:6380");
const db = await FalkorDB.connect({
  socket: { host: url.hostname, port: Number(url.port || 6379) },
  ...(url.password ? { password: url.password } : {}),
});
try {
  const graphs = await db.list();
  if (!graphs.includes(source)) throw new Error(`Legacy graph '${source}' does not exist.`);
  if (graphs.includes(target)) throw new Error(`Target graph '${target}' already exists; refusing to overwrite it.`);
  await db.selectGraph(source).copy(target);
  console.log(`Copied legacy graph '${source}' to organization graph '${target}'. The source was preserved.`);
} finally {
  await db.close();
}
