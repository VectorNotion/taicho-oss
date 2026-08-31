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
  transferFunnelMember,
  FunnelMemberTransferConflictError,
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
  importOutreachProspect,
  importWorkspaceContact,
  markWorkspaceContactLinked,
} from "./data/intake";
export type * from "./domain/types";
export {
  EDGE_LABELS,
  MEMBER_STATUSES,
  NODE_TYPES,
  graphDocumentSchema,
  validateGraph,
} from "./domain/graph";
export type { GraphDocument, GraphEdge, GraphNode, MemberStatus } from "./domain/graph";
export {
  countMembersByNode,
  getGraph,
  GraphVersionConflictError,
  PendingMemberDeliveryError,
  listFunnelEvents,
  moveMember,
  putGraph,
} from "./data/graph-repository";
export type { Attribution, FunnelEvent } from "./data/graph-repository";
export {
  approveStepOutput,
  catchUpMember,
  computeDueMembers,
  configureFunnel,
  FunnelSettingsVersionConflictError,
  getFunnelSettings,
  ingestBounce,
  listMemberProgress,
  listReplies,
  listStepOutputs,
  nodeMetrics,
  recordAttemptSent,
  recordEngagementSignal,
  resumeDecision,
  routeReply,
  saveStepOutput,
  storeReply,
} from "./data/execution-repository";
export type {
  DueMember,
  FunnelSettings,
  MemberRecord,
  ReplyRecord,
  StepOutputRecord,
} from "./data/execution-repository";
export {
  DEFAULT_SEND_WINDOW,
  GOAL_TYPES,
  REPLY_CLASSIFICATIONS,
  sendWindowSchema,
} from "./domain/execution";
export type { ReplyClassification, SendWindow } from "./domain/execution";
export {
  generateTouchDrafts,
  ingestReply,
  rerouteReply,
  settleFunnel,
} from "./agent/execution";
export type { GeneratedDraft, IngestedReply } from "./agent/execution";
export { runCascadeFunnelPass, runFunnel } from "./agent/runner";
export type { FunnelRunSummary } from "./agent/runner";
export { resolveCascadeSender, resendSender, stubSender } from "./delivery/sender";
export type { CascadeSender } from "./delivery/sender";
export { mastraBrain, resolveCascadeBrain, stubCascadeBrain } from "./agent/brain";
export type { CascadeBrain } from "./agent/brain";
