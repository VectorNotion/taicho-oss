export {
  closeCascadePools,
  getCascadeAdminPool,
  getCascadePool,
  schemaName,
} from "./data/pool";
export { assignLegacyCascadeData, ensureCascadeSchema } from "./data/schema";
export {
  appendFunnelStep,
  createFunnel,
  deleteFunnel,
  deleteFunnelRoute,
  deleteFunnelStep,
  getFunnelDetail,
  listEmailSteps,
  listFunnels,
  saveFunnelWorkflow,
  setFunnelRoute,
  updateFunnelStep,
} from "./data/funnel-repository";
export type {
  FunnelBuilderPosition,
  FunnelDetail,
  FunnelSummary,
  FunnelWorkflowRouteInput,
  FunnelWorkflowStepInput,
  SaveFunnelWorkflowInput,
  SaveFunnelWorkflowResult,
} from "./data/funnel-repository";
export {
  createContact,
  listContacts,
} from "./data/contact-repository";
export type { NurtureContactProjection } from "./data/contact-repository";
export { enrollContact, listEnrollments } from "./data/enrollment-repository";
export type { EnrollmentListItem } from "./data/enrollment-repository";
export {
  createContent,
  createEmail,
  createTemplate,
  getEmailBundle,
  getTemplate,
  listContentRecords,
  listEmails,
  listTemplates,
  updateTemplate,
} from "./data/email-repository";
export {
  StaticContentSource,
  WorkspaceContentSource,
  syncAssets,
} from "./data/asset-repository";
export type { ContentSource } from "./data/asset-repository";
export {
  importOutreachLead,
  importWorkspaceContact,
  markWorkspaceContactLinked,
} from "./data/intake";
export { funnelMetrics, runDailyRollup } from "./data/rollups";
export type { StepMetrics } from "./data/rollups";
export { claimDueEnrollment, runTick } from "./engine/tick";
export type { ClaimedRow, TickResult } from "./engine/tick";
export { runSendLoop } from "./engine/send-loop";
export type { SendLoopResult } from "./engine/send-loop";
export { composeSend, publicUrl, renderPreview } from "./engine/compose";
export type { ComposedEmail } from "./engine/compose";
export { deriveTemplateMjml, renderDesignToMjml } from "./domain/design-render";
export {
  DESIGNER_MERGE_TAGS,
  DESIGNER_PALETTE,
  SLOT_MARKERS_BY_TYPE,
  designerBlockDefinitions,
} from "./domain/design-blocks";
export {
  DeterministicE2eMailer,
  DisabledMailer,
  LogMailer,
  MailchimpTransactionalMailer,
  ResendMailer,
  SendGridMailer,
  selectMailer,
} from "./engine/mailer";
export type { Mailer, OutgoingEmail } from "./engine/mailer";
export {
  checkDeliveryProvider,
  connectDeliveryProvider,
  configureDeliveryDomain,
  configureDeliveryProvider,
  createSenderIdentity,
  deliveryWebhookUrl,
  findDeliveryWebhookConfiguration,
  listDeliverySettings,
  markDeliveryWebhookReceived,
  resolveDefaultDeliveryConfiguration,
  setDefaultDelivery,
  setDefaultDeliveryProvider,
} from "./data/delivery-settings-repository";
export {
  decryptDeliveryCredentials,
  deliveryCredentialAssociatedData,
  encryptDeliveryCredentials,
} from "./delivery/credential-crypto";
export { createDeliveryProviderClient } from "./delivery/provider-client";
export { resolveWorkspaceDeliveryRuntime } from "./delivery/runtime";
export type {
  DeliveryCredentials,
  DeliveryDomainSummary,
  DeliveryHealthStatus,
  DeliveryProvider,
  DeliveryProviderSummary,
  DeliverySettingsSummary,
  DeliveryVerificationStatus,
  DeliveryWebhookStatus,
  ResolvedDeliveryConfiguration,
  SenderIdentitySummary,
} from "./delivery/types";
export { createCascadeHttpServer } from "./engine/http";
export { ingestProviderEvent, recordClick, recordOpen, suppressContact } from "./engine/ingest";
export { routeEnrollment, routeOnInterest } from "./engine/routing";
export { signToken, verifyToken } from "./engine/tokens";
export {
  normalizeMailchimpWebhookEvent,
  parseMailchimpWebhookEvents,
  signMailchimpWebhook,
  verifyMailchimpWebhook,
} from "./engine/mailchimp-webhook";
export {
  normalizeSendGridWebhookEvent,
  parseSendGridWebhookEvents,
  verifySendGridWebhook,
} from "./engine/sendgrid-webhook";
export { thompsonPick } from "./engine/bandit";
export type { Arm } from "./engine/bandit";
export {
  activateVariant,
  createVariant,
  deleteVariant,
  getSetting,
  listActiveVariants,
  listVariantsDetailed,
  markRejected,
  markValidated,
  retireVariant,
  setSetting,
} from "./data/variant-repository";
export type { VariantDetail } from "./data/variant-repository";
export { OpenRouterLlm, StubLlm } from "./agent/llm";
export type { LlmClient } from "./agent/llm";
export { generateContentVariants } from "./agent/content-agent";
export { generateTemplate, generateTemplateMjml } from "./agent/template-agent";
export { approveVariant, maybeAutoActivate, validateVariant } from "./agent/validate";
export { runOptimizer } from "./agent/optimizer";
export type * from "./domain/types";
