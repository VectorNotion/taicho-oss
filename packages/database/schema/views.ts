import { pgView, text } from "drizzle-orm/pg-core";

/** Tenant-filtered projection used by the restricted job runtime. */
export const jobWorkspaceMemberIds = pgView("job_workspace_member_ids", {
  organization_id: text().notNull(),
  user_id: text().notNull(),
}).existing();
