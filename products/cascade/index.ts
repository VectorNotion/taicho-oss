export {
  closeCascadePools,
  getCascadeAdminPool,
  getCascadePool,
  schemaName,
} from "./data/pool";
export { assignLegacyCascadeData, ensureCascadeSchema } from "./data/schema";
export {
  addFunnelMember,
  countFunnelMembers,
  createFunnel,
  deleteFunnel,
  getFunnel,
  listFunnelMembers,
  listFunnels,
  removeFunnelMember,
  renameFunnel,
} from "./data/funnel-repository";
export type {
  FunnelMember,
  FunnelSummary,
} from "./data/funnel-repository";
export {
  createPlainTextEmail,
  deletePlainTextEmail,
  getPlainTextEmail,
  listPlainTextEmails,
  plainTextEmailContent,
  updatePlainTextEmail,
} from "./data/plain-text-email-repository";
export {
  createContact,
  listContacts,
} from "./data/contact-repository";
export type { NurtureContactProjection } from "./data/contact-repository";
export {
  importOutreachLead,
  importWorkspaceContact,
  markWorkspaceContactLinked,
} from "./data/intake";
export type * from "./domain/types";
