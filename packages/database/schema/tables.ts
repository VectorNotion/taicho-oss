import { pgTable, unique, text, boolean, timestamp, index, foreignKey, uniqueIndex, integer, bigint, pgSchema, pgPolicy, check, uuid, numeric, jsonb, doublePrecision, varchar, primaryKey, date, customType } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

const organizationIdDefault = sql`NULLIF(current_setting('app.organization_id'::text, true), ''::text)`;
const assistantTenantIdDefault = sql`NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text)`;
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const cascade = pgSchema("cascade");
export const observability = pgSchema("observability");
export const publishing = pgSchema("publishing");
export const assistant = pgSchema("assistant");


export const user = pgTable("user", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	email: text().notNull(),
	emailVerified: boolean().notNull(),
	image: text(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	unique("user_email_key").on(table.email),
]);

export const invitation = pgTable("invitation", {
	id: text().primaryKey().notNull(),
	organizationId: text().notNull(),
	email: text().notNull(),
	role: text(),
	status: text().notNull(),
	expiresAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	inviterId: text().notNull(),
	teamId: text(),
}, (table) => [
	index("invitation_email_idx").using("btree", table.email.asc().nullsLast()),
	index("invitation_organizationId_idx").using("btree", table.organizationId.asc().nullsLast()),
	foreignKey({
			columns: [table.inviterId],
			foreignColumns: [user.id],
			name: "invitation_inviterId_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "invitation_organizationId_fkey"
		}).onDelete("cascade"),
]);

export const account = pgTable("account", {
	id: text().primaryKey().notNull(),
	accountId: text().notNull(),
	providerId: text().notNull(),
	userId: text().notNull(),
	accessToken: text(),
	refreshToken: text(),
	idToken: text(),
	accessTokenExpiresAt: timestamp({ withTimezone: true, mode: 'string' }),
	refreshTokenExpiresAt: timestamp({ withTimezone: true, mode: 'string' }),
	scope: text(),
	password: text(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("account_userId_idx").using("btree", table.userId.asc().nullsLast()),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "account_userId_fkey"
		}).onDelete("cascade"),
]);

export const verification = pgTable("verification", {
	id: text().primaryKey().notNull(),
	identifier: text().notNull(),
	value: text().notNull(),
	expiresAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("verification_identifier_idx").using("btree", table.identifier.asc().nullsLast()),
]);

export const organization = pgTable("organization", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	slug: text().notNull(),
	logo: text(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	metadata: text(),
}, (table) => [
	uniqueIndex("organization_slug_uidx").using("btree", table.slug.asc().nullsLast()),
	unique("organization_slug_key").on(table.slug),
]);

export const member = pgTable("member", {
	id: text().primaryKey().notNull(),
	organizationId: text().notNull(),
	userId: text().notNull(),
	role: text().notNull(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("member_organizationId_idx").using("btree", table.organizationId.asc().nullsLast()),
	uniqueIndex("member_organization_user_unique").using("btree", table.organizationId.asc().nullsLast(), table.userId.asc().nullsLast()),
	index("member_userId_idx").using("btree", table.userId.asc().nullsLast()),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "member_organizationId_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "member_userId_fkey"
		}).onDelete("cascade"),
]);

export const session = pgTable("session", {
	id: text().primaryKey().notNull(),
	expiresAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	token: text().notNull(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	ipAddress: text(),
	userAgent: text(),
	userId: text().notNull(),
	activeOrganizationId: text(),
	activeTeamId: text(),
}, (table) => [
	index("session_userId_idx").using("btree", table.userId.asc().nullsLast()),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "session_userId_fkey"
		}).onDelete("cascade"),
	unique("session_token_key").on(table.token),
]);

export const team = pgTable("team", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	organizationId: text().notNull(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("team_organizationId_idx").using("btree", table.organizationId.asc().nullsLast()),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organization.id],
			name: "team_organizationId_fkey"
		}).onDelete("cascade"),
]);

export const rateLimit = pgTable("rateLimit", {
	id: text().primaryKey().notNull(),
	key: text().notNull(),
	count: integer().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	lastRequest: bigint({ mode: "number" }).notNull(),
}, (table) => [
	unique("rateLimit_key_key").on(table.key),
]);

export const teamMember = pgTable("teamMember", {
	id: text().primaryKey().notNull(),
	teamId: text().notNull(),
	userId: text().notNull(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("teamMember_teamId_idx").using("btree", table.teamId.asc().nullsLast()),
	index("teamMember_userId_idx").using("btree", table.userId.asc().nullsLast()),
	uniqueIndex("team_member_team_user_unique").using("btree", table.teamId.asc().nullsLast(), table.userId.asc().nullsLast()),
	foreignKey({
			columns: [table.teamId],
			foreignColumns: [team.id],
			name: "teamMember_teamId_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "teamMember_userId_fkey"
		}).onDelete("cascade"),
]);

export const variantsInCascade = cascade.table("variants", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	step_id: uuid().notNull(),
	segment: text().default('all').notNull(),
	email_id: uuid().notNull(),
	generation: integer().default(1).notNull(),
	status: text().default('draft').notNull(),
	created_by: text().default('human').notNull(),
	validation_error: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	organization_id: text().default(organizationIdDefault),
}, (table) => [
	uniqueIndex("variants_organization_id_id_key").on(table.organization_id, table.id),
	foreignKey({
			columns: [table.email_id, table.organization_id],
			foreignColumns: [emailsInCascade.id, emailsInCascade.organization_id],
			name: "variants_email_id_organization_fkey"
		}),
	foreignKey({
			columns: [table.step_id, table.organization_id],
			foreignColumns: [funnel_stepsInCascade.id, funnel_stepsInCascade.organization_id],
			name: "variants_step_id_organization_fkey"
		}),
	pgPolicy("variants_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("variants_status_check", sql`status = ANY (ARRAY['draft'::text, 'validated'::text, 'active'::text, 'retired'::text])`),
]).enableRLS();

export const variant_statsInCascade = cascade.table("variant_stats", {
	variant_id: uuid().primaryKey().notNull(),
	sends: integer().default(0).notNull(),
	opens: integer().default(0).notNull(),
	clicks: integer().default(0).notNull(),
	interests: integer().default(0).notNull(),
	conversions: integer().default(0).notNull(),
	revenue: numeric().default('0').notNull(),
	organization_id: text().default(organizationIdDefault),
}, (table) => [
	foreignKey({
			columns: [table.variant_id, table.organization_id],
			foreignColumns: [variantsInCascade.id, variantsInCascade.organization_id],
			name: "variant_stats_variant_id_organization_fkey"
		}),
	pgPolicy("variant_stats_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
]).enableRLS();

export const execution_eventInObservability = observability.table("execution_event", {
	event_id: uuid().primaryKey().notNull(),
	support_code: text().notNull(),
	execution_id: text().notNull(),
	request_id: text().notNull(),
	parent_execution_id: text(),
	organization_id: text(),
	actor_id: text(),
	actor_type: text().notNull(),
	session_id: text(),
	run_id: text(),
	job_id: text(),
	trace_id: text(),
	span_id: text(),
	service_name: text().notNull(),
	operation: text().notNull(),
	status: text().notNull(),
	safe_attributes: jsonb().default({}).notNull(),
	error_type: text(),
	error_code: text(),
	error_fingerprint: text(),
	started_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	completed_at: timestamp({ withTimezone: true, mode: 'string' }),
	duration_ms: doublePrecision(),
	retained_until: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("execution_event_org_time_idx").using("btree", table.organization_id.asc().nullsLast(), table.started_at.desc().nullsFirst()),
	index("execution_event_request_idx").using("btree", table.request_id.asc().nullsLast(), table.started_at.asc().nullsLast()),
	index("execution_event_support_code_idx").using("btree", table.support_code.asc().nullsLast(), table.started_at.desc().nullsFirst()),
	check("execution_event_actor_type_check", sql`actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])`),
	check("execution_event_status_check", sql`status = ANY (ARRAY['started'::text, 'succeeded'::text, 'failed'::text])`),
]);

export const jwks = pgTable("jwks", {
	id: text().primaryKey().notNull(),
	publicKey: text().notNull(),
	privateKey: text().notNull(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	expiresAt: timestamp({ withTimezone: true, mode: 'string' }),
});

export const oauthClient = pgTable("oauthClient", {
	id: text().primaryKey().notNull(),
	clientId: text().notNull(),
	clientSecret: text(),
	disabled: boolean(),
	skipConsent: boolean(),
	enableEndSession: boolean(),
	subjectType: text(),
	scopes: jsonb(),
	userId: text(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }),
	updatedAt: timestamp({ withTimezone: true, mode: 'string' }),
	name: text(),
	uri: text(),
	icon: text(),
	contacts: jsonb(),
	tos: text(),
	policy: text(),
	softwareId: text(),
	softwareVersion: text(),
	softwareStatement: text(),
	redirectUris: jsonb().notNull(),
	postLogoutRedirectUris: jsonb(),
	tokenEndpointAuthMethod: text(),
	grantTypes: jsonb(),
	responseTypes: jsonb(),
	public: boolean(),
	type: text(),
	requirePKCE: boolean(),
	referenceId: text(),
	metadata: jsonb(),
}, (table) => [
	index("oauthClient_userId_idx").using("btree", table.userId.asc().nullsLast()),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "oauthClient_userId_fkey"
		}).onDelete("cascade"),
	unique("oauthClient_clientId_key").on(table.clientId),
]);

export const mastra_threads = pgTable("mastra_threads", {
	id: text().primaryKey().notNull(),
	resourceId: text().notNull(),
	title: text().notNull(),
	metadata: jsonb(),
	createdAt: timestamp({ mode: 'string' }).notNull(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	createdAtZ: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAtZ: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("mastra_threads_resourceid_createdat_idx").using("btree", table.resourceId.asc().nullsLast(), table.createdAt.desc().nullsFirst()),
]);

export const mastra_messages = pgTable("mastra_messages", {
	id: text().primaryKey().notNull(),
	thread_id: text().notNull(),
	content: text().notNull(),
	role: text().notNull(),
	type: text().notNull(),
	createdAt: timestamp({ mode: 'string' }).notNull(),
	resourceId: text(),
	createdAtZ: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("mastra_messages_thread_id_createdat_idx").using("btree", table.thread_id.asc().nullsLast(), table.createdAt.desc().nullsFirst()),
]);

export const mastra_resources = pgTable("mastra_resources", {
	id: text().primaryKey().notNull(),
	workingMemory: text(),
	metadata: jsonb(),
	createdAt: timestamp({ mode: 'string' }).notNull(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	createdAtZ: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAtZ: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
});

export const oauthRefreshToken = pgTable("oauthRefreshToken", {
	id: text().primaryKey().notNull(),
	token: text().notNull(),
	clientId: text().notNull(),
	sessionId: text(),
	userId: text().notNull(),
	referenceId: text(),
	expiresAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	revoked: timestamp({ withTimezone: true, mode: 'string' }),
	authTime: timestamp({ withTimezone: true, mode: 'string' }),
	scopes: jsonb().notNull(),
}, (table) => [
	index("oauthRefreshToken_clientId_idx").using("btree", table.clientId.asc().nullsLast()),
	index("oauthRefreshToken_sessionId_idx").using("btree", table.sessionId.asc().nullsLast()),
	index("oauthRefreshToken_userId_idx").using("btree", table.userId.asc().nullsLast()),
	foreignKey({
			columns: [table.clientId],
			foreignColumns: [oauthClient.clientId],
			name: "oauthRefreshToken_clientId_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [session.id],
			name: "oauthRefreshToken_sessionId_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "oauthRefreshToken_userId_fkey"
		}).onDelete("cascade"),
	unique("oauthRefreshToken_token_key").on(table.token),
]);

export const oauthAccessToken = pgTable("oauthAccessToken", {
	id: text().primaryKey().notNull(),
	token: text().notNull(),
	clientId: text().notNull(),
	sessionId: text(),
	userId: text(),
	referenceId: text(),
	refreshId: text(),
	expiresAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	scopes: jsonb().notNull(),
}, (table) => [
	index("oauthAccessToken_clientId_idx").using("btree", table.clientId.asc().nullsLast()),
	index("oauthAccessToken_refreshId_idx").using("btree", table.refreshId.asc().nullsLast()),
	index("oauthAccessToken_sessionId_idx").using("btree", table.sessionId.asc().nullsLast()),
	index("oauthAccessToken_userId_idx").using("btree", table.userId.asc().nullsLast()),
	foreignKey({
			columns: [table.clientId],
			foreignColumns: [oauthClient.clientId],
			name: "oauthAccessToken_clientId_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.refreshId],
			foreignColumns: [oauthRefreshToken.id],
			name: "oauthAccessToken_refreshId_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [session.id],
			name: "oauthAccessToken_sessionId_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "oauthAccessToken_userId_fkey"
		}).onDelete("cascade"),
	unique("oauthAccessToken_token_key").on(table.token),
]);

export const contentInCascade = cascade.table("content", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	subject: text().notNull(),
	preheader: text(),
	slots: jsonb().default({}).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	organization_id: text().default(organizationIdDefault),
}, (table) => [
	uniqueIndex("content_organization_id_id_key").on(table.organization_id, table.id),
	uniqueIndex("content_org_name_key").using("btree", table.organization_id.asc().nullsLast(), table.name.asc().nullsLast()),
	pgPolicy("content_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
]).enableRLS();

export const emailsInCascade = cascade.table("emails", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	template_id: uuid().notNull(),
	content_id: uuid().notNull(),
	from_email: text().notNull(),
	from_name: text(),
	interest_url: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	organization_id: text().default(organizationIdDefault),
}, (table) => [
	uniqueIndex("emails_organization_id_id_key").on(table.organization_id, table.id),
	foreignKey({
			columns: [table.content_id, table.organization_id],
			foreignColumns: [contentInCascade.id, contentInCascade.organization_id],
			name: "emails_content_id_organization_fkey"
		}),
	foreignKey({
			columns: [table.template_id, table.organization_id],
			foreignColumns: [templatesInCascade.id, templatesInCascade.organization_id],
			name: "emails_template_id_organization_fkey"
		}),
	unique("emails_name_key").on(table.name),
	pgPolicy("emails_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
]).enableRLS();

export const credit_wallet = pgTable("credit_wallet", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: text().notNull(),
	user_id: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	reserved: bigint({ mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	debt: bigint({ mode: "number" }).default(0).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organization.id],
			name: "credit_wallet_organization_id_fkey"
		}).onDelete("cascade"),
	unique("credit_wallet_organization_id_user_id_key").on(table.organization_id, table.user_id),
	check("credit_wallet_debt_check", sql`debt >= 0`),
	check("credit_wallet_reserved_check", sql`reserved >= 0`),
]);

export const cascade_settingsInCascade = cascade.table("cascade_settings", {
	key: text().notNull(),
	value: jsonb().notNull(),
	organization_id: text().default(organizationIdDefault),
}, (table) => [
	uniqueIndex("cascade_settings_org_key").using("btree", table.organization_id.asc().nullsLast(), table.key.asc().nullsLast()),
	pgPolicy("cascade_settings_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
]).enableRLS();

export const delivery_domainsInCascade = cascade.table("delivery_domains", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	provider_connection_id: uuid().notNull(),
	name: text().notNull(),
	provider_domain_id: text(),
	verification_status: text().default('unknown').notNull(),
	last_checked_at: timestamp({ withTimezone: true, mode: 'string' }),
	last_error_code: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	organization_id: text().default(organizationIdDefault),
}, (table) => [
	uniqueIndex("delivery_domains_organization_id_id_key").on(table.organization_id, table.id),
	uniqueIndex("delivery_domain_org_name_key").using("btree", table.organization_id.asc().nullsLast(), table.provider_connection_id.asc().nullsLast(), table.name.asc().nullsLast()),
	foreignKey({
			columns: [table.provider_connection_id, table.organization_id],
			foreignColumns: [delivery_provider_connectionsInCascade.id, delivery_provider_connectionsInCascade.organization_id],
			name: "delivery_domains_provider_connection_id_organization_fkey"
		}).onDelete("cascade"),
	pgPolicy("delivery_domains_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("delivery_domains_verification_status_check", sql`verification_status = ANY (ARRAY['unknown'::text, 'pending'::text, 'verified'::text, 'failed'::text])`),
]).enableRLS();

export const credit_ledger = pgTable("credit_ledger", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	wallet_id: uuid().notNull(),
	kind: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	amount: bigint({ mode: "number" }).notNull(),
	lot_id: uuid(),
	reservation_id: uuid(),
	actor_user_id: text(),
	reason: text(),
	metadata: jsonb().default({}).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("credit_ledger_wallet_idx").using("btree", table.wallet_id.asc().nullsLast(), table.created_at.desc().nullsFirst()),
	foreignKey({
			columns: [table.lot_id],
			foreignColumns: [credit_lot.id],
			name: "credit_ledger_lot_id_fkey"
		}),
	foreignKey({
			columns: [table.wallet_id],
			foreignColumns: [credit_wallet.id],
			name: "credit_ledger_wallet_id_fkey"
		}).onDelete("cascade"),
]);

export const credit_reservation = pgTable("credit_reservation", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	wallet_id: uuid().notNull(),
	organization_id: text().notNull(),
	initiating_user_id: text().notNull(),
	action: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	estimated: bigint({ mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	settled: bigint({ mode: "number" }),
	status: text().default('active').notNull(),
	idempotency_key: text().notNull(),
	metadata: jsonb().default({}).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	settled_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.wallet_id],
			foreignColumns: [credit_wallet.id],
			name: "credit_reservation_wallet_id_fkey"
		}).onDelete("cascade"),
	unique("credit_reservation_idempotency_key_key").on(table.idempotency_key),
	check("credit_reservation_estimated_check", sql`estimated > 0`),
	check("credit_reservation_status_check", sql`status = ANY (ARRAY['active'::text, 'settled'::text, 'released'::text])`),
]);

export const usage_event = pgTable("usage_event", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: text().notNull(),
	user_id: text().notNull(),
	wallet_id: uuid().notNull(),
	reservation_id: uuid(),
	kind: text().notNull(),
	provider: text(),
	model: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	measured_units: bigint({ mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	credits: bigint({ mode: "number" }).notNull(),
	idempotency_key: text().notNull(),
	metadata: jsonb().default({}).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("usage_event_org_idx").using("btree", table.organization_id.asc().nullsLast(), table.created_at.desc().nullsFirst()),
	foreignKey({
			columns: [table.reservation_id],
			foreignColumns: [credit_reservation.id],
			name: "usage_event_reservation_id_fkey"
		}),
	foreignKey({
			columns: [table.wallet_id],
			foreignColumns: [credit_wallet.id],
			name: "usage_event_wallet_id_fkey"
		}),
	unique("usage_event_idempotency_key_key").on(table.idempotency_key),
]);

export const commercial_audit = pgTable("commercial_audit", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: text(),
	actor_user_id: text().notNull(),
	action: text().notNull(),
	reason: text().notNull(),
	before_value: jsonb(),
	after_value: jsonb(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const commercial_request = pgTable("commercial_request", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: text().notNull(),
	user_id: text().notNull(),
	kind: text().notNull(),
	requested_plan_id: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	requested_credits: bigint({ mode: "number" }),
	status: text().default('pending').notNull(),
	note: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	check("commercial_request_kind_check", sql`kind = ANY (ARRAY['upgrade'::text, 'top_up'::text])`),
]);

export const oauthConsent = pgTable("oauthConsent", {
	id: text().primaryKey().notNull(),
	clientId: text().notNull(),
	userId: text(),
	referenceId: text(),
	scopes: jsonb().notNull(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("oauthConsent_clientId_idx").using("btree", table.clientId.asc().nullsLast()),
	index("oauthConsent_userId_idx").using("btree", table.userId.asc().nullsLast()),
	foreignKey({
			columns: [table.clientId],
			foreignColumns: [oauthClient.clientId],
			name: "oauthConsent_clientId_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "oauthConsent_userId_fkey"
		}).onDelete("cascade"),
]);

export const mastra_agents = pgTable("mastra_agents", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	instructions: text().notNull(),
	model: jsonb().notNull(),
	tools: jsonb(),
	defaultOptions: jsonb(),
	workflows: jsonb(),
	agents: jsonb(),
	inputProcessors: jsonb(),
	outputProcessors: jsonb(),
	memory: jsonb(),
	scorers: jsonb(),
	metadata: jsonb(),
	createdAt: timestamp({ mode: 'string' }).notNull(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	createdAtZ: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAtZ: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
});

export const mastra_scorers = pgTable("mastra_scorers", {
	id: text().primaryKey().notNull(),
	scorerId: text().notNull(),
	traceId: text(),
	spanId: text(),
	runId: text().notNull(),
	scorer: jsonb().notNull(),
	preprocessStepResult: jsonb(),
	extractStepResult: jsonb(),
	analyzeStepResult: jsonb(),
	score: doublePrecision().notNull(),
	reason: text(),
	metadata: jsonb(),
	preprocessPrompt: text(),
	extractPrompt: text(),
	generateScorePrompt: text(),
	generateReasonPrompt: text(),
	analyzePrompt: text(),
	reasonPrompt: text(),
	input: jsonb().notNull(),
	output: jsonb().notNull(),
	additionalContext: jsonb(),
	requestContext: jsonb(),
	entityType: text(),
	entity: jsonb(),
	entityId: text(),
	source: text().notNull(),
	resourceId: text(),
	threadId: text(),
	createdAt: timestamp({ mode: 'string' }).notNull(),
	updatedAt: timestamp({ mode: 'string' }).notNull(),
	createdAtZ: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAtZ: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("mastra_scores_trace_id_span_id_created_at_idx").using("btree", table.traceId.asc().nullsLast(), table.spanId.asc().nullsLast(), table.createdAt.desc().nullsFirst()),
]);

export const enterprise_inquiry = pgTable("enterprise_inquiry", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	email: text().notNull(),
	company: text().notNull(),
	team_size: text(),
	requirements: text().notNull(),
	status: text().default('new').notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const delivery_provider_connectionsInCascade = cascade.table("delivery_provider_connections", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	provider: text().notNull(),
	display_name: text().notNull(),
	credential_ciphertext: text().notNull(),
	credential_key_version: text().notNull(),
	enabled: boolean().default(true).notNull(),
	is_default: boolean().default(false).notNull(),
	health_status: text().default('unchecked').notNull(),
	last_checked_at: timestamp({ withTimezone: true, mode: 'string' }),
	last_error_code: text(),
	webhook_status: text().default('not_configured').notNull(),
	webhook_configured_at: timestamp({ withTimezone: true, mode: 'string' }),
	webhook_last_received_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	organization_id: text().default(organizationIdDefault),
}, (table) => [
	uniqueIndex("delivery_provider_connections_organization_id_id_key").on(table.organization_id, table.id),
	uniqueIndex("delivery_provider_org_default_key").using("btree", table.organization_id.asc().nullsLast()).where(sql`(is_default = true)`),
	uniqueIndex("delivery_provider_org_provider_key").using("btree", table.organization_id.asc().nullsLast(), table.provider.asc().nullsLast()),
	pgPolicy("delivery_provider_connections_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("delivery_provider_connections_health_status_check", sql`health_status = ANY (ARRAY['unchecked'::text, 'connected'::text, 'error'::text])`),
	check("delivery_provider_connections_provider_check", sql`provider = ANY (ARRAY['resend'::text, 'sendgrid'::text, 'mailchimp'::text])`),
	check("delivery_provider_connections_webhook_status_check", sql`webhook_status = ANY (ARRAY['not_configured'::text, 'configured'::text, 'receiving'::text, 'error'::text])`),
]).enableRLS();

export const delivery_sender_identitiesInCascade = cascade.table("delivery_sender_identities", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	provider_connection_id: uuid().notNull(),
	domain_id: uuid().notNull(),
	name: text().notNull(),
	email: text().notNull(),
	verification_status: text().default('unknown').notNull(),
	is_default: boolean().default(false).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	organization_id: text().default(organizationIdDefault),
}, (table) => [
	uniqueIndex("delivery_sender_identities_organization_id_id_key").on(table.organization_id, table.id),
	uniqueIndex("delivery_sender_org_default_key").using("btree", table.organization_id.asc().nullsLast()).where(sql`(is_default = true)`),
	uniqueIndex("delivery_sender_org_email_key").using("btree", table.organization_id.asc().nullsLast(), table.provider_connection_id.asc().nullsLast(), table.email.asc().nullsLast()),
	foreignKey({
			columns: [table.domain_id, table.organization_id],
			foreignColumns: [delivery_domainsInCascade.id, delivery_domainsInCascade.organization_id],
			name: "delivery_sender_identities_domain_id_organization_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.provider_connection_id, table.organization_id],
			foreignColumns: [delivery_provider_connectionsInCascade.id, delivery_provider_connectionsInCascade.organization_id],
			name: "delivery_sender_identities_provider_connection_id_organization_"
		}).onDelete("cascade"),
	pgPolicy("delivery_sender_identities_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("delivery_sender_identities_verification_status_check", sql`verification_status = ANY (ARRAY['unknown'::text, 'pending'::text, 'verified'::text, 'failed'::text])`),
]).enableRLS();

export const postsInPublishing = publishing.table("posts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	draft_id: text(),
	destination: text().notNull(),
	channel_id: text().notNull(),
	copy: jsonb().default({}).notNull(),
	media_key: text(),
	publish_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	status: text().default('scheduled').notNull(),
	attempts: integer().default(0).notNull(),
	next_attempt_at: timestamp({ withTimezone: true, mode: 'string' }),
	claimed_at: timestamp({ withTimezone: true, mode: 'string' }),
	idempotency_key: text(),
	result_url: text(),
	error: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	organization_id: text().default(organizationIdDefault).notNull(),
	created_by: text(),
	actor_type: text(),
	request_id: text(),
	parent_execution_id: text(),
	trace_id: text(),
	traceparent: text(),
}, (table) => [
	index("idx_publishing_posts_due").using("btree", table.status.asc().nullsLast(), table.publish_at.asc().nullsLast()),
	uniqueIndex("posts_org_idempotency_key").using("btree", table.organization_id.asc().nullsLast(), table.idempotency_key.asc().nullsLast()),
	foreignKey({
			columns: [table.channel_id, table.organization_id],
			foreignColumns: [channelsInPublishing.id, channelsInPublishing.org_id],
			name: "posts_channel_organization_fkey"
		}),
	pgPolicy("posts_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("posts_actor_type_check", sql`(actor_type IS NULL) OR (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text]))`),
	check("posts_status_check", sql`status = ANY (ARRAY['scheduled'::text, 'publishing'::text, 'published'::text, 'failed'::text, 'cancelled'::text])`),
]).enableRLS();

export const contentGenerationRunsInPublishing = publishing.table("content_generation_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: text().default(organizationIdDefault).notNull(),
	draft_id: text().notNull(),
	template_key: text().notNull(),
	template_version: integer().default(1).notNull(),
	media_kind: text().notNull(),
	asset_role: text().default('primary').notNull(),
	model_key: text().notNull(),
	deployment_id: text().notNull(),
	provider: text().default('fal').notNull(),
	provider_request_id: text(),
	status: text().default('queued').notNull(),
	progress: integer().default(0).notNull(),
	input: jsonb().default({}).notNull(),
	provider_result: jsonb(),
	error: text(),
	credit_reservation_id: uuid(),
	estimated_credits: integer().default(0).notNull(),
	actual_credits: integer(),
	created_by: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	started_at: timestamp({ withTimezone: true, mode: 'string' }),
	completed_at: timestamp({ withTimezone: true, mode: 'string' }),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("content_generation_runs_draft_idx").using("btree", table.organization_id.asc().nullsLast(), table.draft_id.asc().nullsLast(), table.created_at.desc().nullsFirst()),
	index("content_generation_runs_reconcile_idx").using("btree", table.status.asc().nullsLast(), table.updated_at.asc().nullsLast()).where(sql`(status = ANY (ARRAY['submitted'::text, 'processing'::text]))`),
	uniqueIndex("content_generation_runs_organization_id_id_key").using("btree", table.organization_id.asc().nullsLast(), table.id.asc().nullsLast()),
	uniqueIndex("content_generation_runs_provider_request_key").using("btree", table.provider.asc().nullsLast(), table.provider_request_id.asc().nullsLast()).where(sql`provider_request_id IS NOT NULL`),
	pgPolicy("content_generation_runs_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("content_generation_runs_kind_check", sql`media_kind = ANY (ARRAY['image'::text, 'video'::text, 'audio'::text])`),
	check("content_generation_runs_progress_check", sql`(progress >= 0) AND (progress <= 100)`),
	check("content_generation_runs_provider_check", sql`provider = 'fal'::text`),
	check("content_generation_runs_status_check", sql`status = ANY (ARRAY['queued'::text, 'submitted'::text, 'processing'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text])`),
]).enableRLS();

export const contentAssetsInPublishing = publishing.table("content_assets", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: text().default(organizationIdDefault).notNull(),
	generation_run_id: uuid().notNull(),
	output_index: integer().notNull(),
	draft_id: text().notNull(),
	asset_role: text().default('primary').notNull(),
	media_kind: text().notNull(),
	file_name: text().notNull(),
	mime_type: text().notNull(),
	r2_key: text().notNull(),
	width: integer(),
	height: integer(),
	duration_ms: integer(),
	byte_size: integer().notNull(),
	is_selected: boolean().default(false).notNull(),
	metadata: jsonb().default({}).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("content_assets_draft_idx").using("btree", table.organization_id.asc().nullsLast(), table.draft_id.asc().nullsLast(), table.created_at.desc().nullsFirst()),
	index("content_assets_run_idx").using("btree", table.organization_id.asc().nullsLast(), table.generation_run_id.asc().nullsLast()),
	uniqueIndex("content_assets_run_output_key").using("btree", table.organization_id.asc().nullsLast(), table.generation_run_id.asc().nullsLast(), table.output_index.asc().nullsLast()),
	uniqueIndex("content_assets_selected_role_key").using("btree", table.organization_id.asc().nullsLast(), table.draft_id.asc().nullsLast(), table.asset_role.asc().nullsLast()).where(sql`is_selected = true`),
	foreignKey({
		columns: [table.organization_id, table.generation_run_id],
		foreignColumns: [contentGenerationRunsInPublishing.organization_id, contentGenerationRunsInPublishing.id],
		name: "content_assets_generation_run_organization_fkey"
	}).onDelete("cascade"),
	pgPolicy("content_assets_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("content_assets_byte_size_check", sql`byte_size >= 0`),
	check("content_assets_kind_check", sql`media_kind = ANY (ARRAY['image'::text, 'video'::text, 'audio'::text])`),
	check("content_assets_output_index_check", sql`output_index >= 0`),
]).enableRLS();

export const mcp_service_principal = pgTable("mcp_service_principal", {
	oauth_client_id: text().primaryKey().notNull(),
	organization_id: text().notNull(),
	billing_user_id: text().notNull(),
	role: text().default('member').notNull(),
	allowed_scopes: text().array().default(["vn:read"]).notNull(),
	allowed_resources: text().array().default(["mcp"]).notNull(),
	enabled: boolean().default(true).notNull(),
	created_by_user_id: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("mcp_service_principal_organization_idx").using("btree", table.organization_id.asc().nullsLast(), table.enabled.asc().nullsLast()),
	foreignKey({
			columns: [table.billing_user_id],
			foreignColumns: [user.id],
			name: "mcp_service_principal_billing_user_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.created_by_user_id],
			foreignColumns: [user.id],
			name: "mcp_service_principal_created_by_user_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.oauth_client_id],
			foreignColumns: [oauthClient.clientId],
			name: "mcp_service_principal_oauth_client_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organization.id],
			name: "mcp_service_principal_organization_id_fkey"
		}).onDelete("cascade"),
	check("mcp_service_principal_allowed_resources_check", sql`cardinality(allowed_resources) > 0 AND allowed_resources <@ ARRAY['api'::text, 'mcp'::text]`),
]);

export const external_api_rate_limit = pgTable("external_api_rate_limit", {
	organization_id: text().notNull(),
	oauth_client_id: text().notNull(),
	bucket: text().notNull(),
	window_start: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	request_count: integer().default(1).notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	primaryKey({ columns: [table.organization_id, table.oauth_client_id, table.bucket, table.window_start], name: "external_api_rate_limit_pkey" }),
	index("external_api_rate_limit_expiry_idx").using("btree", table.expires_at.asc().nullsLast()),
	foreignKey({
			columns: [table.oauth_client_id],
			foreignColumns: [oauthClient.clientId],
			name: "external_api_rate_limit_oauth_client_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organization.id],
			name: "external_api_rate_limit_organization_fk"
		}).onDelete("cascade"),
	pgPolicy("external_api_rate_limit_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))` }),
	check("external_api_rate_limit_count_check", sql`request_count > 0`),
]).enableRLS();

export const credit_lot = pgTable("credit_lot", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	wallet_id: uuid().notNull(),
	source: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	amount: bigint({ mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	remaining: bigint({ mode: "number" }).notNull(),
	grant_key: text(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("credit_lot_spend_idx").using("btree", table.wallet_id.asc().nullsLast(), table.expires_at.asc().nullsLast(), table.created_at.asc().nullsLast()).where(sql`(remaining > 0)`),
	foreignKey({
			columns: [table.wallet_id],
			foreignColumns: [credit_wallet.id],
			name: "credit_lot_wallet_id_fkey"
		}).onDelete("cascade"),
	unique("credit_lot_grant_key_key").on(table.grant_key),
	check("credit_lot_amount_check", sql`amount > 0`),
	check("credit_lot_remaining_check", sql`remaining >= 0`),
	check("credit_lot_source_check", sql`source = ANY (ARRAY['included'::text, 'weekly_grant'::text, 'purchased'::text, 'adjustment'::text])`),
]);

export const billing_subscription = pgTable("billing_subscription", {
	organization_id: text().primaryKey().notNull(),
	checkout_session_id: uuid(),
	provider: text().default('razorpay').notNull(),
	provider_subscription_id: text().notNull(),
	plan_id: text().notNull(),
	plan_version: integer().notNull(),
	seats: integer().default(1).notNull(),
	status: text().notNull(),
	current_start: timestamp({ withTimezone: true, mode: 'string' }),
	current_end: timestamp({ withTimezone: true, mode: 'string' }),
	cancel_at_period_end: boolean().default(false).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	provider_plan_id: text(),
	scheduled_plan_id: text(),
	scheduled_plan_version: integer(),
	scheduled_provider_plan_id: text(),
	scheduled_seats: integer(),
	billing_country: text(),
}, (table) => [
	foreignKey({
			columns: [table.checkout_session_id],
			foreignColumns: [payment_checkout_session.id],
			name: "billing_subscription_checkout_session_id_fkey"
		}),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organization.id],
			name: "billing_subscription_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.plan_id, table.plan_version],
			foreignColumns: [commercial_plan_version.plan_id, commercial_plan_version.version],
			name: "billing_subscription_plan_id_plan_version_fkey"
		}),
	unique("billing_subscription_provider_subscription_id_key").on(table.provider_subscription_id),
	check("billing_subscription_provider_check", sql`provider = ANY (ARRAY['razorpay'::text, 'stripe'::text, 'paypal'::text])`),
	check("billing_subscription_scheduled_seats_check", sql`scheduled_seats > 0`),
	check("billing_subscription_seats_check", sql`seats > 0`),
]);

export const organization_subscription = pgTable("organization_subscription", {
	organization_id: text().primaryKey().notNull(),
	plan_id: text().notNull(),
	plan_version: integer().default(1).notNull(),
	status: text().default('active').notNull(),
	seat_count: integer().default(1).notNull(),
	period_start: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	period_end: timestamp({ withTimezone: true, mode: 'string' }).default(sql`(now() + '1 mon'::interval)`).notNull(),
	scheduled_plan_id: text(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	scheduled_plan_version: integer(),
	scheduled_seat_count: integer(),
	trial_started_at: timestamp({ withTimezone: true, mode: 'string' }),
	credit_user_id: text(),
}, (table) => [
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organization.id],
			name: "organization_subscription_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.plan_id, table.plan_version],
			foreignColumns: [commercial_plan_version.plan_id, commercial_plan_version.version],
			name: "organization_subscription_plan_id_plan_version_fkey"
		}),
	check("organization_subscription_scheduled_seat_count_check", sql`scheduled_seat_count > 0`),
	check("organization_subscription_seat_count_check", sql`seat_count > 0`),
	check("organization_subscription_status_check", sql`status = ANY (ARRAY['active'::text, 'scheduled_change'::text, 'cancelled'::text])`),
]);

export const eventsInCascade = cascade.table("events", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "cascade.events_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: "9223372036854775807", cache: 1 }),
	contact_id: uuid().notNull(),
	enrollment_id: uuid(),
	send_id: uuid(),
	type: text().notNull(),
	value: numeric(),
	occurred_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	organization_id: text().default(organizationIdDefault),
}, (table) => [
	uniqueIndex("events_organization_id_id_key").using("btree", table.organization_id.asc().nullsLast(), table.id.asc().nullsLast()),
	foreignKey({
			columns: [table.contact_id, table.organization_id],
			foreignColumns: [contactsInCascade.id, contactsInCascade.organization_id],
			name: "events_contact_id_organization_fkey"
		}),
	foreignKey({
			columns: [table.enrollment_id, table.organization_id],
			foreignColumns: [enrollmentsInCascade.id, enrollmentsInCascade.organization_id],
			name: "events_enrollment_id_organization_fkey"
		}),
	foreignKey({
			columns: [table.send_id, table.organization_id],
			foreignColumns: [sendsInCascade.id, sendsInCascade.organization_id],
			name: "events_send_id_organization_fkey"
		}),
	pgPolicy("events_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("events_type_check", sql`type = ANY (ARRAY['queued'::text, 'sent'::text, 'delivered'::text, 'open'::text, 'click'::text, 'bounce'::text, 'complaint'::text, 'unsub'::text, 'interest'::text, 'convert'::text])`),
]).enableRLS();

export const post_metric_snapshots = pgTable("post_metric_snapshots", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: text().default(organizationIdDefault).notNull(),
	post_id: text().notNull(),
	draft_id: text(),
	captured_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	source: text().notNull(),
	metrics: jsonb().default({}).notNull(),
}, (table) => [
	index("idx_post_metric_snapshots_org_draft").using("btree", table.organization_id.asc().nullsLast(), table.draft_id.asc().nullsLast(), table.captured_at.desc().nullsFirst()),
	index("idx_post_metric_snapshots_org_post").using("btree", table.organization_id.asc().nullsLast(), table.post_id.asc().nullsLast(), table.captured_at.desc().nullsFirst()),
	pgPolicy("post_metric_snapshots_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("post_metric_snapshots_source_check", sql`source = ANY (ARRAY['human'::text, 'platform_api'::text, 'plugin'::text, 'provider_webhook'::text, 'link_redirect'::text])`),
]).enableRLS();

export const top_up_payment_session = pgTable("top_up_payment_session", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	token_hash: text().notNull(),
	organization_id: text().notNull(),
	user_id: text().notNull(),
	catalog_version: text().notNull(),
	billing_country: text().notNull(),
	top_up_code: text().notNull(),
	top_up_name: text().notNull(),
	top_up_description: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	credits: bigint({ mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	amount_minor: bigint({ mode: "number" }).notNull(),
	currency: text().notNull(),
	validity_days: integer().notNull(),
	provider: text().default('razorpay').notNull(),
	provider_receipt: text().notNull(),
	provider_order_id: text(),
	provider_payment_id: text(),
	status: text().default('created').notNull(),
	return_url: text().notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	verified_at: timestamp({ withTimezone: true, mode: 'string' }),
	fulfilled_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	reconcile_attempts: integer().default(0).notNull(),
	next_reconcile_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	last_reconcile_error: text(),
}, (table) => [
	index("top_up_payment_expiry_idx").using("btree", table.expires_at.asc().nullsLast()).where(sql`(status = ANY (ARRAY['created'::text, 'checkout_ready'::text, 'processing'::text]))`),
	index("top_up_payment_org_idx").using("btree", table.organization_id.asc().nullsLast(), table.created_at.desc().nullsFirst()),
	index("top_up_payment_reconcile_idx").using("btree", table.next_reconcile_at.asc().nullsLast()).where(sql`((fulfilled_at IS NULL) AND (provider_order_id IS NOT NULL) AND (status = ANY (ARRAY['checkout_ready'::text, 'processing'::text, 'expired'::text])))`),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organization.id],
			name: "top_up_payment_session_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [user.id],
			name: "top_up_payment_session_user_id_fkey"
		}).onDelete("restrict"),
	unique("top_up_payment_session_token_hash_key").on(table.token_hash),
	unique("top_up_payment_session_provider_receipt_key").on(table.provider_receipt),
	unique("top_up_payment_session_provider_order_id_key").on(table.provider_order_id),
	unique("top_up_payment_session_provider_payment_id_key").on(table.provider_payment_id),
	check("top_up_payment_session_amount_minor_check", sql`amount_minor > 0`),
	check("top_up_payment_session_credits_check", sql`credits > 0`),
	check("top_up_payment_session_provider_check", sql`provider = ANY (ARRAY['razorpay'::text, 'stripe'::text, 'paypal'::text])`),
	check("top_up_payment_session_reconcile_attempts_check", sql`reconcile_attempts >= 0`),
	check("top_up_payment_session_status_check", sql`status = ANY (ARRAY['created'::text, 'checkout_ready'::text, 'processing'::text, 'paid'::text, 'failed'::text, 'expired'::text, 'cancelled'::text])`),
	check("top_up_payment_session_validity_days_check", sql`validity_days > 0`),
]);

export const payment_transaction = pgTable("payment_transaction", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	checkout_session_id: uuid(),
	organization_id: text().notNull(),
	provider: text().default('razorpay').notNull(),
	provider_payment_id: text().notNull(),
	provider_subscription_id: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	amount_minor: bigint({ mode: "number" }).notNull(),
	currency: text().notNull(),
	status: text().notNull(),
	method: text(),
	captured_at: timestamp({ withTimezone: true, mode: 'string' }),
	raw: jsonb().default({}).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	top_up_session_id: uuid(),
}, (table) => [
	foreignKey({
			columns: [table.checkout_session_id],
			foreignColumns: [payment_checkout_session.id],
			name: "payment_transaction_checkout_session_id_fkey"
		}),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organization.id],
			name: "payment_transaction_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.top_up_session_id],
			foreignColumns: [top_up_payment_session.id],
			name: "payment_transaction_top_up_session_id_fkey"
		}),
	unique("payment_transaction_provider_payment_id_key").on(table.provider_payment_id),
	check("payment_transaction_amount_minor_check", sql`amount_minor >= 0`),
	check("payment_transaction_provider_check", sql`provider = ANY (ARRAY['razorpay'::text, 'stripe'::text, 'paypal'::text])`),
	check("payment_transaction_session_check", sql`((checkout_session_id IS NOT NULL) AND (top_up_session_id IS NULL)) OR ((checkout_session_id IS NULL) AND (top_up_session_id IS NOT NULL))`),
]);

export const payment_checkout_session = pgTable("payment_checkout_session", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	token_hash: text().notNull(),
	organization_id: text().notNull(),
	user_id: text().notNull(),
	plan_id: text().notNull(),
	plan_version: integer().notNull(),
	seats: integer().default(1).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	amount_minor: bigint({ mode: "number" }).notNull(),
	currency: text().notNull(),
	status: text().default('created').notNull(),
	provider: text().default('razorpay').notNull(),
	provider_subscription_id: text(),
	provider_payment_id: text(),
	return_url: text().notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	verified_at: timestamp({ withTimezone: true, mode: 'string' }),
	fulfilled_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	market: text().default('india').notNull(),
	billing_country: text().default('IN').notNull(),
	provider_plan_id: text(),
	billing_interval: text().default('month').notNull(),
}, (table) => [
	index("payment_checkout_expiry_idx").using("btree", table.expires_at.asc().nullsLast()).where(sql`(status = ANY (ARRAY['created'::text, 'checkout_ready'::text, 'processing'::text]))`),
	index("payment_checkout_org_idx").using("btree", table.organization_id.asc().nullsLast(), table.created_at.desc().nullsFirst()),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organization.id],
			name: "payment_checkout_session_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.plan_id, table.plan_version],
			foreignColumns: [commercial_plan_version.plan_id, commercial_plan_version.version],
			name: "payment_checkout_session_plan_id_plan_version_fkey"
		}),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [user.id],
			name: "payment_checkout_session_user_id_fkey"
		}).onDelete("restrict"),
	unique("payment_checkout_session_token_hash_key").on(table.token_hash),
	unique("payment_checkout_session_provider_subscription_id_key").on(table.provider_subscription_id),
	check("payment_checkout_session_amount_minor_check", sql`amount_minor > 0`),
	check("payment_checkout_session_billing_interval_check", sql`billing_interval = ANY (ARRAY['month'::text, 'year'::text])`),
	check("payment_checkout_session_market_check", sql`market = ANY (ARRAY['india'::text, 'international'::text])`),
	check("payment_checkout_session_provider_check", sql`provider = ANY (ARRAY['razorpay'::text, 'stripe'::text, 'paypal'::text])`),
	check("payment_checkout_session_seats_check", sql`seats > 0`),
	check("payment_checkout_session_status_check", sql`status = ANY (ARRAY['created'::text, 'checkout_ready'::text, 'processing'::text, 'paid'::text, 'failed'::text, 'expired'::text, 'cancelled'::text])`),
]);

export const funnel_stepsInCascade = cascade.table("funnel_steps", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	funnel_id: uuid().notNull(),
	position: integer().notNull(),
	type: text().notNull(),
	config: jsonb().default({}).notNull(),
	organization_id: text().default(organizationIdDefault),
}, (table) => [
	uniqueIndex("funnel_steps_organization_id_id_key").on(table.organization_id, table.id),
	foreignKey({
			columns: [table.funnel_id, table.organization_id],
			foreignColumns: [funnelsInCascade.id, funnelsInCascade.organization_id],
			name: "funnel_steps_funnel_id_organization_fkey"
		}).onDelete("cascade"),
	unique("funnel_steps_funnel_id_position_key").on(table.funnel_id, table.position),
	pgPolicy("funnel_steps_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("funnel_steps_position_check", sql`"position" >= 1`),
	check("funnel_steps_type_check", sql`type = ANY (ARRAY['email'::text, 'delay'::text, 'branch'::text, 'goal'::text])`),
]).enableRLS();

export const contactsInCascade = cascade.table("contacts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	email: text().notNull(),
	attributes: jsonb().default({}).notNull(),
	timezone: text(),
	subscription_status: text().default('subscribed').notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	outreach_lead_id: text(),
	organization_id: text().default(organizationIdDefault),
	workspace_contact_id: text(),
	workspace_contact_linked_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	uniqueIndex("contacts_organization_id_id_key").on(table.organization_id, table.id),
	uniqueIndex("contacts_org_email_key").using("btree", table.organization_id.asc().nullsLast(), table.email.asc().nullsLast()),
	uniqueIndex("contacts_org_workspace_contact_key").using("btree", table.organization_id.asc().nullsLast(), table.workspace_contact_id.asc().nullsLast()).where(sql`(workspace_contact_id IS NOT NULL)`),
	pgPolicy("contacts_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("contacts_subscription_status_check", sql`subscription_status = ANY (ARRAY['subscribed'::text, 'unsubscribed'::text, 'suppressed'::text])`),
]).enableRLS();

export const enrollmentsInCascade = cascade.table("enrollments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	funnel_id: uuid().notNull(),
	contact_id: uuid().notNull(),
	current_step_id: uuid(),
	state: text().default('active').notNull(),
	next_run_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	created_by: text(),
	actor_type: text(),
	request_id: text(),
	parent_execution_id: text(),
	trace_id: text(),
	traceparent: text(),
	organization_id: text().default(organizationIdDefault),
}, (table) => [
	uniqueIndex("enrollments_organization_id_id_key").on(table.organization_id, table.id),
	index("enrollments_due_idx").using("btree", table.next_run_at.asc().nullsLast()).where(sql`(state = 'active'::text)`),
	foreignKey({
			columns: [table.contact_id, table.organization_id],
			foreignColumns: [contactsInCascade.id, contactsInCascade.organization_id],
			name: "enrollments_contact_id_organization_fkey"
		}),
	foreignKey({
			columns: [table.current_step_id, table.organization_id],
			foreignColumns: [funnel_stepsInCascade.id, funnel_stepsInCascade.organization_id],
			name: "enrollments_current_step_id_organization_fkey"
		}),
	foreignKey({
			columns: [table.funnel_id, table.organization_id],
			foreignColumns: [funnelsInCascade.id, funnelsInCascade.organization_id],
			name: "enrollments_funnel_id_organization_fkey"
		}),
	pgPolicy("enrollments_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("enrollments_actor_type_check", sql`(actor_type IS NULL) OR (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text]))`),
	check("enrollments_state_check", sql`state = ANY (ARRAY['active'::text, 'completed'::text, 'stopped'::text])`),
]).enableRLS();

export const sendsInCascade = cascade.table("sends", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	enrollment_id: uuid().notNull(),
	step_id: uuid().notNull(),
	provider_message_id: text(),
	status: text().default('queued').notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	attempts: integer().default(0).notNull(),
	variant_id: uuid(),
	created_by: text(),
	actor_type: text(),
	request_id: text(),
	parent_execution_id: text(),
	trace_id: text(),
	traceparent: text(),
	organization_id: text().default(organizationIdDefault),
	delivery_provider_id: uuid(),
	sender_identity_id: uuid(),
}, (table) => [
	uniqueIndex("sends_organization_id_id_key").on(table.organization_id, table.id),
	foreignKey({
			columns: [table.organization_id, table.delivery_provider_id],
			foreignColumns: [delivery_provider_connectionsInCascade.id, delivery_provider_connectionsInCascade.organization_id],
			name: "sends_delivery_provider_id_organization_fkey"
		}),
	foreignKey({
			columns: [table.enrollment_id, table.organization_id],
			foreignColumns: [enrollmentsInCascade.id, enrollmentsInCascade.organization_id],
			name: "sends_enrollment_id_organization_fkey"
		}),
	foreignKey({
			columns: [table.organization_id, table.sender_identity_id],
			foreignColumns: [delivery_sender_identitiesInCascade.id, delivery_sender_identitiesInCascade.organization_id],
			name: "sends_sender_identity_id_organization_fkey"
		}),
	foreignKey({
			columns: [table.step_id, table.organization_id],
			foreignColumns: [funnel_stepsInCascade.id, funnel_stepsInCascade.organization_id],
			name: "sends_step_id_organization_fkey"
		}),
	foreignKey({
			columns: [table.variant_id, table.organization_id],
			foreignColumns: [variantsInCascade.id, variantsInCascade.organization_id],
			name: "sends_variant_id_organization_fkey"
		}),
	unique("sends_enrollment_id_step_id_key").on(table.enrollment_id, table.step_id),
	pgPolicy("sends_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("sends_actor_type_check", sql`(actor_type IS NULL) OR (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text]))`),
	check("sends_status_check", sql`status = ANY (ARRAY['queued'::text, 'sent'::text, 'failed'::text, 'skipped'::text])`),
]).enableRLS();

export const templatesInCascade = cascade.table("templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	mjml: text().notNull(),
	compiled_html: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	design_json: jsonb(),
	organization_id: text().default(organizationIdDefault),
}, (table) => [
	uniqueIndex("templates_organization_id_id_key").on(table.organization_id, table.id),
	uniqueIndex("templates_org_name_key").using("btree", table.organization_id.asc().nullsLast(), table.name.asc().nullsLast()),
	pgPolicy("templates_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
]).enableRLS();

export const pricing_rollout = pgTable("pricing_rollout", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	provider: text().default('razorpay').notNull(),
	environment: text().notNull(),
	plan_id: text().notNull(),
	catalog_country: text().notNull(),
	from_provider_plan_id: text().notNull(),
	to_provider_plan_id: text().notNull(),
	target_plan_version: integer().notNull(),
	policy: text().default('cycle-end').notNull(),
	status: text().default('queued').notNull(),
	source_catalog_version: text().notNull(),
	reason: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	started_at: timestamp({ withTimezone: true, mode: 'string' }),
	completed_at: timestamp({ withTimezone: true, mode: 'string' }),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("pricing_rollout_status_idx").using("btree", table.status.asc().nullsLast(), table.created_at.asc().nullsLast()),
	foreignKey({
			columns: [table.plan_id, table.target_plan_version],
			foreignColumns: [commercial_plan_version.plan_id, commercial_plan_version.version],
			name: "pricing_rollout_plan_id_target_plan_version_fkey"
		}),
	unique("pricing_rollout_provider_environment_catalog_country_plan_i_key").on(table.provider, table.environment, table.plan_id, table.catalog_country, table.from_provider_plan_id, table.to_provider_plan_id),
	check("pricing_rollout_environment_check", sql`environment = ANY (ARRAY['test'::text, 'live'::text])`),
	check("pricing_rollout_policy_check", sql`policy = ANY (ARRAY['cycle-end'::text, 'new-customers-only'::text])`),
	check("pricing_rollout_status_check", sql`status = ANY (ARRAY['queued'::text, 'running'::text, 'scheduled'::text, 'attention'::text, 'completed'::text, 'cancelled'::text])`),
]);

export const offersInCascade = cascade.table("offers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: text().notNull(),
	claim: text().notNull(),
	active: boolean().default(true).notNull(),
	organization_id: text().default(organizationIdDefault),
}, (table) => [
	uniqueIndex("offers_org_code_key").using("btree", table.organization_id.asc().nullsLast(), table.code.asc().nullsLast()),
	uniqueIndex("offers_organization_id_id_key").using("btree", table.organization_id.asc().nullsLast(), table.id.asc().nullsLast()),
	pgPolicy("offers_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
]).enableRLS();

export const pricing_rollout_item = pgTable("pricing_rollout_item", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	rollout_id: uuid().notNull(),
	organization_id: text().notNull(),
	provider_subscription_id: text().notNull(),
	seats: integer().notNull(),
	status: text().default('queued').notNull(),
	attempts: integer().default(0).notNull(),
	provider_status: text(),
	payment_method: text(),
	last_error: text(),
	next_attempt_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	scheduled_at: timestamp({ withTimezone: true, mode: 'string' }),
	applied_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("pricing_rollout_item_claim_idx").using("btree", table.status.asc().nullsLast(), table.next_attempt_at.asc().nullsLast(), table.created_at.asc().nullsLast()).where(sql`(status = ANY (ARRAY['queued'::text, 'retry'::text]))`),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organization.id],
			name: "pricing_rollout_item_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.rollout_id],
			foreignColumns: [pricing_rollout.id],
			name: "pricing_rollout_item_rollout_id_fkey"
		}).onDelete("cascade"),
	unique("pricing_rollout_item_rollout_id_provider_subscription_id_key").on(table.rollout_id, table.provider_subscription_id),
	check("pricing_rollout_item_attempts_check", sql`attempts >= 0`),
	check("pricing_rollout_item_seats_check", sql`seats > 0`),
	check("pricing_rollout_item_status_check", sql`status = ANY (ARRAY['queued'::text, 'processing'::text, 'retry'::text, 'scheduled'::text, 'applied'::text, 'skipped'::text, 'blocked'::text])`),
]);

export const platform_catalog_snapshots = pgTable("platform_catalog_snapshots", {
	id: text().primaryKey().notNull(),
	catalog_version: text().notNull(),
	catalog: jsonb().notNull(),
	source_generated_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	synced_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const funnelsInCascade = cascade.table("funnels", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	version: integer().default(1).notNull(),
	open_ended: boolean().default(false).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	organization_id: text().default(organizationIdDefault),
	builder_layout: jsonb().default({}).notNull(),
}, (table) => [
	uniqueIndex("funnels_organization_id_id_key").on(table.organization_id, table.id),
	pgPolicy("funnels_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
]).enableRLS();

export const funnel_membersInCascade = cascade.table("funnel_members", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	funnel_id: uuid().notNull(),
	contact_id: uuid().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	created_by: text(),
	actor_type: text(),
	request_id: text(),
	parent_execution_id: text(),
	trace_id: text(),
	traceparent: text(),
	organization_id: text().default(organizationIdDefault),
}, (table) => [
	foreignKey({ columns: [table.funnel_id, table.organization_id], foreignColumns: [funnelsInCascade.id, funnelsInCascade.organization_id], name: "funnel_members_funnel_id_organization_fkey" }).onDelete("cascade"),
	foreignKey({ columns: [table.contact_id, table.organization_id], foreignColumns: [contactsInCascade.id, contactsInCascade.organization_id], name: "funnel_members_contact_id_organization_fkey" }).onDelete("cascade"),
	uniqueIndex("funnel_members_organization_id_id_key").on(table.organization_id, table.id),
	unique("funnel_members_funnel_id_contact_id_key").on(table.funnel_id, table.contact_id),
	index("funnel_members_funnel_created_idx").on(table.funnel_id, table.created_at),
	check("funnel_members_actor_type_check", sql`(actor_type IS NULL) OR (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text]))`),
	pgPolicy("funnel_members_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))` }),
]).enableRLS();

export const plain_text_emailsInCascade = cascade.table("plain_text_emails", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	funnel_id: uuid().notNull(),
	name: text().notNull(),
	subject: text().notNull(),
	body: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	created_by: text(),
	actor_type: text(),
	request_id: text(),
	parent_execution_id: text(),
	trace_id: text(),
	traceparent: text(),
	organization_id: text().default(organizationIdDefault),
}, (table) => [
	foreignKey({ columns: [table.funnel_id, table.organization_id], foreignColumns: [funnelsInCascade.id, funnelsInCascade.organization_id], name: "plain_text_emails_funnel_id_organization_fkey" }).onDelete("cascade"),
	uniqueIndex("plain_text_emails_organization_id_id_key").on(table.organization_id, table.id),
	unique("plain_text_emails_funnel_id_name_key").on(table.funnel_id, table.name),
	index("plain_text_emails_funnel_updated_idx").on(table.funnel_id, table.updated_at),
	check("plain_text_emails_name_check", sql`length(btrim(name)) > 0`),
	check("plain_text_emails_subject_check", sql`length(btrim(subject)) > 0`),
	check("plain_text_emails_body_check", sql`length(btrim(body)) > 0`),
	check("plain_text_emails_actor_type_check", sql`(actor_type IS NULL) OR (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text]))`),
	pgPolicy("plain_text_emails_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))` }),
]).enableRLS();

export const assetsInCascade = cascade.table("assets", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	source_id: text().notNull(),
	type: text().notNull(),
	title: text().notNull(),
	url: text().notNull(),
	topics: jsonb().default([]).notNull(),
	published_at: timestamp({ withTimezone: true, mode: 'string' }),
	synced_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	organization_id: text().default(organizationIdDefault),
}, (table) => [
	uniqueIndex("assets_org_source_key").using("btree", table.organization_id.asc().nullsLast(), table.source_id.asc().nullsLast()),
	uniqueIndex("assets_organization_id_id_key").using("btree", table.organization_id.asc().nullsLast(), table.id.asc().nullsLast()),
	pgPolicy("assets_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
]).enableRLS();

export const mcp_audit_event = pgTable("mcp_audit_event", {
	id: text().primaryKey().notNull(),
	occurred_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	request_id: text().notNull(),
	organization_id: text().notNull(),
	actor_type: text().notNull(),
	actor_user_id: text(),
	oauth_client_id: text().notNull(),
	capability_id: text().notNull(),
	status: text().notNull(),
	duration_ms: integer().notNull(),
	affected_entity_ids: text().array().default([]).notNull(),
	error_code: text(),
	idempotency_key: text(),
	credit_delta: integer(),
	metadata: jsonb().default({}).notNull(),
}, (table) => [
	index("mcp_audit_event_org_time_idx").using("btree", table.organization_id.asc().nullsLast(), table.occurred_at.desc().nullsFirst()),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organization.id],
			name: "mcp_audit_event_organization_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("mcp_audit_event_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("mcp_audit_event_actor_type_check", sql`actor_type = ANY (ARRAY['user'::text, 'service'::text])`),
	check("mcp_audit_event_status_check", sql`status = ANY (ARRAY['succeeded'::text, 'failed'::text, 'denied'::text])`),
]).enableRLS();

export const mcp_operation = pgTable("mcp_operation", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: text().notNull(),
	oauth_client_id: text().notNull(),
	actor_user_id: text(),
	actor_type: text().default('service').notNull(),
	billing_user_id: text().notNull(),
	action: text().notNull(),
	entity_id: text(),
	payload: jsonb().default({}).notNull(),
	status: text().default('queued').notNull(),
	progress: integer().default(0).notNull(),
	attempt: integer().default(0).notNull(),
	max_attempts: integer().default(3).notNull(),
	lease_expires_at: timestamp({ withTimezone: true, mode: 'string' }),
	result: jsonb(),
	error: jsonb(),
	credit_reservation_id: uuid(),
	estimated_credits: integer().default(0).notNull(),
	idempotency_key: text().notNull(),
	request_id: text(),
	parent_execution_id: text(),
	trace_id: text(),
	traceparent: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	started_at: timestamp({ withTimezone: true, mode: 'string' }),
	completed_at: timestamp({ withTimezone: true, mode: 'string' }),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("mcp_operation_org_time_idx").using("btree", table.organization_id.asc().nullsLast(), table.created_at.desc().nullsFirst()),
	index("mcp_operation_queue_idx").using("btree", table.status.asc().nullsLast(), table.lease_expires_at.asc().nullsLast(), table.created_at.asc().nullsLast()).where(sql`(status = ANY (ARRAY['queued'::text, 'processing'::text]))`),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organization.id],
			name: "mcp_operation_organization_id_fkey"
		}).onDelete("cascade"),
	unique("mcp_operation_organization_id_oauth_client_id_action_idempo_key").on(table.organization_id, table.oauth_client_id, table.action, table.idempotency_key),
	pgPolicy("mcp_operation_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("mcp_operation_actor_type_check", sql`actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])`),
	check("mcp_operation_progress_check", sql`(progress >= 0) AND (progress <= 100)`),
	check("mcp_operation_status_check", sql`status = ANY (ARRAY['queued'::text, 'processing'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text])`),
]).enableRLS();

export const mcp_connection = pgTable("mcp_connection", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: text().notNull(),
	name: text().notNull(),
	server_url: text().notNull(),
	auth_type: text().default('none').notNull(),
	credential_env: text(),
	header_name: text(),
	allowed_tools: text().array().default([]).notNull(),
	pinned_tool_schemas: jsonb().default({}).notNull(),
	discovered_server: jsonb(),
	last_tested_at: timestamp({ withTimezone: true, mode: 'string' }),
	last_used_at: timestamp({ withTimezone: true, mode: 'string' }),
	enabled: boolean().default(true).notNull(),
	created_by: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("mcp_connection_org_idx").using("btree", table.organization_id.asc().nullsLast(), table.enabled.asc().nullsLast()),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organization.id],
			name: "mcp_connection_organization_id_fkey"
		}).onDelete("cascade"),
	unique("mcp_connection_organization_id_name_key").on(table.organization_id, table.name),
	pgPolicy("mcp_connection_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("mcp_connection_auth_type_check", sql`auth_type = ANY (ARRAY['none'::text, 'bearer_env'::text, 'header_env'::text, 'oauth_client_credentials_env'::text])`),
]).enableRLS();

export const mcp_media_upload = pgTable("mcp_media_upload", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: text().notNull(),
	oauth_client_id: text().notNull(),
	actor_user_id: text(),
	actor_type: text().default('service').notNull(),
	request_id: text(),
	parent_execution_id: text(),
	trace_id: text(),
	traceparent: text(),
	token_hash: text().notNull(),
	file_name: text().notNull(),
	content_type: text().notNull(),
	max_bytes: integer().notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	consumed_at: timestamp({ withTimezone: true, mode: 'string' }),
	media_key: text(),
	byte_size: integer(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("mcp_media_upload_org_idx").using("btree", table.organization_id.asc().nullsLast(), table.created_at.desc().nullsFirst()),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organization.id],
			name: "mcp_media_upload_organization_id_fkey"
		}).onDelete("cascade"),
	unique("mcp_media_upload_token_hash_key").on(table.token_hash),
	pgPolicy("mcp_media_upload_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("mcp_media_upload_actor_type_check", sql`actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])`),
	check("mcp_media_upload_max_bytes_check", sql`max_bytes > 0`),
]).enableRLS();

export const funnel_routesInCascade = cascade.table("funnel_routes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	from_funnel_id: uuid().notNull(),
	outcome: text().notNull(),
	to_funnel_id: uuid().notNull(),
	organization_id: text().default(organizationIdDefault),
}, (table) => [
	uniqueIndex("funnel_routes_organization_id_id_key").using("btree", table.organization_id.asc().nullsLast(), table.id.asc().nullsLast()),
	foreignKey({
			columns: [table.from_funnel_id, table.organization_id],
			foreignColumns: [funnelsInCascade.id, funnelsInCascade.organization_id],
			name: "funnel_routes_from_funnel_id_organization_fkey"
		}),
	foreignKey({
			columns: [table.to_funnel_id, table.organization_id],
			foreignColumns: [funnelsInCascade.id, funnelsInCascade.organization_id],
			name: "funnel_routes_to_funnel_id_organization_fkey"
		}),
	unique("funnel_routes_from_funnel_id_outcome_key").on(table.from_funnel_id, table.outcome),
	pgPolicy("funnel_routes_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("funnel_routes_outcome_check", sql`outcome = ANY (ARRAY['completed'::text, 'interest'::text])`),
]).enableRLS();

export const jobs = pgTable("jobs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	type: varchar({ length: 50 }).notNull(),
	product: varchar({ length: 20 }).notNull(),
	entity_id: varchar({ length: 100 }).notNull(),
	entity_type: varchar({ length: 50 }),
	status: varchar({ length: 20 }).default('queued').notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	started_at: timestamp({ withTimezone: true, mode: 'string' }),
	completed_at: timestamp({ withTimezone: true, mode: 'string' }),
	result: jsonb(),
	error: text(),
	organization_id: text().default(organizationIdDefault),
	initiating_user_id: text(),
	actor_type: text().default('system').notNull(),
	wallet_user_id: text(),
	credit_reservation_id: uuid(),
	request_id: text(),
	parent_execution_id: text(),
	trace_id: text(),
	traceparent: text(),
}, (table) => [
	index("idx_jobs_created_at").using("btree", table.created_at.desc().nullsFirst()),
	index("idx_jobs_entity").using("btree", table.entity_id.asc().nullsLast(), table.entity_type.asc().nullsLast()),
	index("idx_jobs_org_status").using("btree", table.organization_id.asc().nullsLast(), table.status.asc().nullsLast(), table.created_at.desc().nullsFirst()),
	index("idx_jobs_status").using("btree", table.status.asc().nullsLast()),
	pgPolicy("jobs_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("jobs_actor_type_check", sql`actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])`),
	check("valid_status", sql`(status)::text = ANY ((ARRAY['queued'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying])::text[])`),
]).enableRLS();

export const product_events = pgTable("product_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: text().notNull(),
	name: text().notNull(),
	event_version: integer().default(1).notNull(),
	occurred_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	content_id: text(),
	lead_id: text(),
	post_id: text(),
	send_id: text(),
	source: text().default('product').notNull(),
	origin: text().default('internal').notNull(),
	connector_id: text(),
	external_event_id: text(),
	payload: jsonb().default({}).notNull(),
}, (table) => [
	index("idx_product_events_org_name_time").using("btree", table.organization_id.asc().nullsLast(), table.name.asc().nullsLast(), table.occurred_at.desc().nullsFirst()),
	index("idx_product_events_time").using("btree", table.occurred_at.asc().nullsLast(), table.id.asc().nullsLast()),
	uniqueIndex("product_events_external_delivery_key").using("btree", table.organization_id.asc().nullsLast(), table.connector_id.asc().nullsLast(), table.external_event_id.asc().nullsLast(), table.name.asc().nullsLast()).where(sql`(origin = 'external_connector' AND connector_id IS NOT NULL AND external_event_id IS NOT NULL)`),
	unique("product_events_id_organization_key").on(table.id, table.organization_id),
	pgPolicy("product_events_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("product_events_origin_check", sql`origin = ANY (ARRAY['internal'::text, 'external_connector'::text])`),
]).enableRLS();

export const external_webhook_endpoint = pgTable("external_webhook_endpoint", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: text().notNull(),
	created_by_oauth_client_id: text().notNull(),
	url: text().notNull(),
	description: text(),
	event_types: text().array().notNull(),
	signing_secret_ciphertext: text().notNull(),
	signing_secret_hash: text().notNull(),
	enabled: boolean().default(true).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("external_webhook_endpoint_org_url_key").on(table.organization_id, table.url),
	unique("external_webhook_endpoint_id_org_key").on(table.id, table.organization_id),
	index("external_webhook_endpoint_org_enabled_idx").using("btree", table.organization_id.asc().nullsLast(), table.enabled.asc().nullsLast()),
	foreignKey({ columns: [table.organization_id], foreignColumns: [organization.id], name: "external_webhook_endpoint_organization_fk" }).onDelete("cascade"),
	foreignKey({ columns: [table.created_by_oauth_client_id], foreignColumns: [oauthClient.clientId], name: "external_webhook_endpoint_client_fk" }).onDelete("cascade"),
	pgPolicy("external_webhook_endpoint_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))` }),
	check("external_webhook_endpoint_events_check", sql`cardinality(event_types) > 0`),
]).enableRLS();

export const external_webhook_delivery = pgTable("external_webhook_delivery", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: text().notNull(),
	endpoint_id: uuid().notNull(),
	event_id: uuid().notNull(),
	event_type: text().notNull(),
	payload: jsonb().notNull(),
	status: text().default('queued').notNull(),
	attempt: integer().default(0).notNull(),
	max_attempts: integer().default(8).notNull(),
	next_attempt_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lease_expires_at: timestamp({ withTimezone: true, mode: 'string' }),
	response_status: integer(),
	error: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	completed_at: timestamp({ withTimezone: true, mode: 'string' }),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("external_webhook_delivery_endpoint_event_key").on(table.endpoint_id, table.event_id),
	index("external_webhook_delivery_claim_idx").using("btree", table.status.asc().nullsLast(), table.next_attempt_at.asc().nullsLast()),
	index("external_webhook_delivery_org_time_idx").using("btree", table.organization_id.asc().nullsLast(), table.created_at.desc().nullsFirst()),
	foreignKey({ columns: [table.endpoint_id, table.organization_id], foreignColumns: [external_webhook_endpoint.id, external_webhook_endpoint.organization_id], name: "external_webhook_delivery_endpoint_fk" }).onDelete("cascade"),
	foreignKey({ columns: [table.event_id, table.organization_id], foreignColumns: [product_events.id, product_events.organization_id], name: "external_webhook_delivery_event_fk" }).onDelete("cascade"),
	pgPolicy("external_webhook_delivery_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))` }),
	check("external_webhook_delivery_status_check", sql`status = ANY (ARRAY['queued'::text, 'delivering'::text, 'succeeded'::text, 'failed'::text])`),
	check("external_webhook_delivery_attempt_check", sql`attempt >= 0 AND max_attempts > 0`),
]).enableRLS();

export const metric_ingest_tokens = pgTable("metric_ingest_tokens", {
	organization_id: text().primaryKey().notNull(),
	token: uuid().defaultRandom().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	rotated_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	unique("metric_ingest_tokens_token_key").on(table.token),
	pgPolicy("metric_ingest_tokens_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
]).enableRLS();

export const team_administrator = pgTable("team_administrator", {
	team_id: text().notNull(),
	member_id: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.member_id],
			foreignColumns: [member.id],
			name: "team_administrator_member_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.team_id],
			foreignColumns: [team.id],
			name: "team_administrator_team_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.team_id, table.member_id], name: "team_administrator_pkey"}),
]);

export const webhook_receiptsInCascade = cascade.table("webhook_receipts", {
	organization_id: text().default(organizationIdDefault).notNull(),
	id: text().notNull(),
	received_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	primaryKey({ columns: [table.organization_id, table.id], name: "webhook_receipts_pkey"}),
	pgPolicy("webhook_receipts_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
]).enableRLS();

export const organization_entitlement = pgTable("organization_entitlement", {
	organization_id: text().notNull(),
	product: text().notNull(),
	enabled: boolean().default(true).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organization.id],
			name: "organization_entitlement_organization_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.organization_id, table.product], name: "organization_entitlement_pkey"}),
	check("organization_entitlement_product_check", sql`product = ANY (ARRAY['outreach'::text, 'content'::text, 'cascade'::text])`),
]);

export const identity_linksInAssistant = assistant.table("identity_links", {
	tenant_id: text().default(assistantTenantIdDefault).notNull(),
	source_subject_id: text().notNull(),
	target_subject_id: text().notNull(),
	verified_by: text().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	primaryKey({ columns: [table.tenant_id, table.source_subject_id, table.target_subject_id], name: "identity_links_pkey"}),
	pgPolicy("identity_links_tenant_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text))`, withCheck: sql`(tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text))`  }),
	check("identity_links_verified_by_check", sql`verified_by = ANY (ARRAY['authenticated_session'::text, 'verified_email'::text])`),
]).enableRLS();

export const rate_limit_bucketsInAssistant = assistant.table("rate_limit_buckets", {
	tenant_id: text().default(assistantTenantIdDefault).notNull(),
	key: text().notNull(),
	hits: integer().default(0).notNull(),
	window_started_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("rate_limit_expiry_idx").using("btree", table.expires_at.asc().nullsLast()),
	primaryKey({ columns: [table.tenant_id, table.key], name: "rate_limit_buckets_pkey"}),
	pgPolicy("rate_limit_buckets_tenant_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text))`, withCheck: sql`(tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text))`  }),
]).enableRLS();

export const request_receiptsInAssistant = assistant.table("request_receipts", {
	tenant_id: text().default(assistantTenantIdDefault).notNull(),
	purpose: text().notNull(),
	request_id: text().notNull(),
	received_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("request_receipts_expiry_idx").using("btree", table.expires_at.asc().nullsLast()),
	primaryKey({ columns: [table.tenant_id, table.purpose, table.request_id], name: "request_receipts_pkey"}),
	pgPolicy("request_receipts_tenant_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text))`, withCheck: sql`(tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text))`  }),
	check("request_receipts_purpose_check", sql`purpose = ANY (ARRAY['sales'::text, 'knowledge'::text])`),
]).enableRLS();

export const idempotency_keysInAssistant = assistant.table("idempotency_keys", {
	tenant_id: text().default(assistantTenantIdDefault).notNull(),
	key: text().notNull(),
	operation: text().notNull(),
	result: jsonb().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("idempotency_expiry_idx").using("btree", table.expires_at.asc().nullsLast()),
	primaryKey({ columns: [table.tenant_id, table.key, table.operation], name: "idempotency_keys_pkey"}),
	pgPolicy("idempotency_keys_tenant_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text))`, withCheck: sql`(tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text))`  }),
]).enableRLS();

export const stage_daily_statsInCascade = cascade.table("stage_daily_stats", {
	day: date().notNull(),
	funnel_id: uuid().notNull(),
	step_id: uuid().notNull(),
	sends: integer().default(0).notNull(),
	opens: integer().default(0).notNull(),
	clicks: integer().default(0).notNull(),
	interests: integer().default(0).notNull(),
	organization_id: text().default(organizationIdDefault),
}, (table) => [
	foreignKey({
			columns: [table.funnel_id, table.organization_id],
			foreignColumns: [funnelsInCascade.id, funnelsInCascade.organization_id],
			name: "stage_daily_stats_funnel_id_organization_fkey"
		}),
	foreignKey({
			columns: [table.step_id, table.organization_id],
			foreignColumns: [funnel_stepsInCascade.id, funnel_stepsInCascade.organization_id],
			name: "stage_daily_stats_step_id_organization_fkey"
		}),
	primaryKey({ columns: [table.day, table.funnel_id, table.step_id], name: "stage_daily_stats_pkey"}),
	pgPolicy("stage_daily_stats_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
]).enableRLS();

export const payment_provider_event = pgTable("payment_provider_event", {
	provider: text().default('razorpay').notNull(),
	event_id: text().notNull(),
	event_type: text().notNull(),
	payload: jsonb().notNull(),
	processing_status: text().default('received').notNull(),
	error: text(),
	received_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	processed_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	primaryKey({ columns: [table.provider, table.event_id], name: "payment_provider_event_pkey"}),
	check("payment_provider_event_processing_status_check", sql`processing_status = ANY (ARRAY['received'::text, 'processed'::text, 'ignored'::text, 'failed'::text])`),
	check("payment_provider_event_provider_check", sql`provider = ANY (ARRAY['razorpay'::text, 'stripe'::text, 'paypal'::text])`),
]);

export const commercial_rate_card = pgTable("commercial_rate_card", {
	kind: text().notNull(),
	provider: text().default('*').notNull(),
	model: text().default('*').notNull(),
	version: integer().notNull(),
	unit: text().notNull(),
	credits_per_unit: numeric({ precision: 18, scale:  6 }).notNull(),
	active: boolean().default(true).notNull(),
	effective_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	metadata: jsonb().default({"normalized_credit_usd":0.001}).notNull(),
}, (table) => [
	primaryKey({ columns: [table.kind, table.provider, table.model, table.version], name: "commercial_rate_card_pkey"}),
	check("commercial_rate_card_credits_per_unit_check", sql`credits_per_unit >= (0)::numeric`),
]);

export const messagesInAssistant = assistant.table("messages", {
	tenant_id: text().default(assistantTenantIdDefault).notNull(),
	id: uuid().defaultRandom().notNull(),
	conversation_id: uuid().notNull(),
	request_id: uuid().notNull(),
	role: text().notNull(),
	content: text().notNull(),
	citations: jsonb().default([]).notNull(),
	metadata: jsonb().default({}).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("messages_conversation_idx").using("btree", table.tenant_id.asc().nullsLast(), table.conversation_id.asc().nullsLast(), table.created_at.asc().nullsLast()),
	foreignKey({
			columns: [table.tenant_id, table.conversation_id],
			foreignColumns: [conversationsInAssistant.tenant_id, conversationsInAssistant.id],
			name: "messages_tenant_id_conversation_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.tenant_id, table.id], name: "messages_pkey"}),
	unique("messages_tenant_id_conversation_id_request_id_role_key").on(table.tenant_id, table.conversation_id, table.request_id, table.role),
	pgPolicy("messages_tenant_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text))`, withCheck: sql`(tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text))`  }),
	check("messages_role_check", sql`role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text])`),
]).enableRLS();

export const commercial_plan_price = pgTable("commercial_plan_price", {
	plan_id: text().notNull(),
	plan_version: integer().notNull(),
	market: text().notNull(),
	provider: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	amount_minor: bigint({ mode: "number" }).notNull(),
	currency: text().notNull(),
	display_price: text().notNull(),
	active: boolean().default(true).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.plan_id, table.plan_version],
			foreignColumns: [commercial_plan_version.plan_id, commercial_plan_version.version],
			name: "commercial_plan_price_plan_id_plan_version_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.plan_id, table.plan_version, table.market], name: "commercial_plan_price_pkey"}),
	check("commercial_plan_price_amount_minor_check", sql`amount_minor > 0`),
	check("commercial_plan_price_currency_check", sql`currency = ANY (ARRAY['INR'::text, 'USD'::text])`),
	check("commercial_plan_price_market_check", sql`market = ANY (ARRAY['india'::text, 'international'::text])`),
	check("commercial_plan_price_provider_check", sql`provider = ANY (ARRAY['razorpay'::text, 'paypal'::text])`),
]);

export const channelsInPublishing = publishing.table("channels", {
	id: text().notNull(),
	destination: text().notNull(),
	name: text().notNull(),
	credential_kind: text().notNull(),
	credentials: jsonb().default({}).notNull(),
	token_expiry: timestamp({ withTimezone: true, mode: 'string' }),
	extra: jsonb().default({}).notNull(),
	org_id: text().default(organizationIdDefault).notNull(),
	disabled: boolean().default(false).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	primaryKey({ columns: [table.id, table.org_id], name: "channels_pkey"}),
	pgPolicy("channels_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(org_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(org_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("channels_credential_kind_check", sql`credential_kind = ANY (ARRAY['oauth2'::text, 'oauth1'::text, 'api_key'::text, 'signing_secret'::text, 'none'::text])`),
]).enableRLS();

export const documentsInAssistant = assistant.table("documents", {
	tenant_id: text().default(assistantTenantIdDefault).notNull(),
	id: uuid().defaultRandom().notNull(),
	source_id: text().notNull(),
	url: text().notNull(),
	title: text().notNull(),
	heading: text(),
	content: text().notNull(),
	content_hash: text().notNull(),
	metadata: jsonb().default({}).notNull(),
	search_vector: tsvector("search_vector").generatedAlwaysAs(sql`to_tsvector('english'::regconfig, ((((COALESCE(title, ''::text) || ' '::text) || COALESCE(heading, ''::text)) || ' '::text) || content))`),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("documents_search_idx").using("gin", table.search_vector.asc().nullsLast()),
	primaryKey({ columns: [table.tenant_id, table.id], name: "documents_pkey"}),
	unique("documents_tenant_id_source_id_key").on(table.tenant_id, table.source_id),
	pgPolicy("documents_tenant_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text))`, withCheck: sql`(tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text))`  }),
]).enableRLS();

export const conversationsInAssistant = assistant.table("conversations", {
	tenant_id: text().default(assistantTenantIdDefault).notNull(),
	id: uuid().defaultRandom().notNull(),
	surface: text().notNull(),
	subject_id: text().notNull(),
	account_id: text(),
	user_id: text(),
	status: text().default('open').notNull(),
	lead_state: jsonb().default({}).notNull(),
	failed_answer_count: integer().default(0).notNull(),
	metadata: jsonb().default({}).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("conversations_account_idx").using("btree", table.tenant_id.asc().nullsLast(), table.account_id.asc().nullsLast(), table.updated_at.desc().nullsFirst()),
	index("conversations_subject_idx").using("btree", table.tenant_id.asc().nullsLast(), table.subject_id.asc().nullsLast(), table.updated_at.desc().nullsFirst()),
	primaryKey({ columns: [table.tenant_id, table.id], name: "conversations_pkey"}),
	pgPolicy("conversations_tenant_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text))`, withCheck: sql`(tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text))`  }),
	check("conversations_status_check", sql`status = ANY (ARRAY['open'::text, 'escalated'::text, 'resolved'::text, 'closed'::text])`),
	check("conversations_surface_check", sql`surface = ANY (ARRAY['sales'::text, 'support'::text])`),
]).enableRLS();

export const mcp_idempotency_key = pgTable("mcp_idempotency_key", {
	organization_id: text().notNull(),
	oauth_client_id: text().notNull(),
	capability_id: text().notNull(),
	idempotency_key: text().notNull(),
	input_hash: text().notNull(),
	status: text().notNull(),
	result: jsonb(),
	error: jsonb(),
	lease_expires_at: timestamp({ withTimezone: true, mode: 'string' }).default(sql`(now() + '00:02:00'::interval)`).notNull(),
	attempts: integer().default(1).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organization.id],
			name: "mcp_idempotency_key_organization_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.organization_id, table.oauth_client_id, table.capability_id, table.idempotency_key], name: "mcp_idempotency_key_pkey"}),
	pgPolicy("mcp_idempotency_key_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("mcp_idempotency_key_status_check", sql`status = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed'::text])`),
]).enableRLS();

export const commercial_plan_version = pgTable("commercial_plan_version", {
	plan_id: text().notNull(),
	version: integer().notNull(),
	name: text().notNull(),
	description: text().notNull(),
	display_price: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	weekly_credits: bigint({ mode: "number" }).notNull(),
	capabilities: text().array().default([]).notNull(),
	per_seat: boolean().default(false).notNull(),
	contact_sales: boolean().default(false).notNull(),
	active: boolean().default(true).notNull(),
	effective_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	amount_minor: bigint({ mode: "number" }).default(0).notNull(),
	currency: text().default('INR').notNull(),
	payload_plan_id: text(),
	catalog_version: text(),
	catalog_country: text(),
	catalog_provider: text(),
	catalog_environment: text(),
	billing_model: text().default('fixed').notNull(),
	call_to_action_label: text(),
	highlighted: boolean().default(false).notNull(),
	sort_order: integer().default(0).notNull(),
	billing_interval_count: integer(),
	per_user: boolean().default(false).notNull(),
	provider_plan_id: text(),
	existing_subscriber_policy: text().default('cycle-end').notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	included_credits: bigint({ mode: "number" }).default(0).notNull(),
	credit_owner: text().default('user').notNull(),
	credit_cadence: text().default('billing-period').notNull(),
	trial_days: integer(),
	billing_interval: text(),
}, (table) => [
	uniqueIndex("commercial_plan_source_idx").using("btree", table.plan_id.asc().nullsLast(), table.catalog_version.asc().nullsLast()).where(sql`(catalog_version IS NOT NULL)`),
	primaryKey({ columns: [table.plan_id, table.version], name: "commercial_plan_version_pkey"}),
	check("commercial_plan_version_amount_minor_check", sql`amount_minor >= 0`),
	check("commercial_plan_version_billing_interval_check", sql`billing_interval = ANY (ARRAY['month'::text, 'year'::text])`),
	check("commercial_plan_version_billing_interval_count_check", sql`billing_interval_count > 0`),
	check("commercial_plan_version_billing_model_check", sql`billing_model = ANY (ARRAY['trial'::text, 'per-user'::text, 'per-seat'::text, 'contact-sales'::text])`),
	check("commercial_plan_version_credit_cadence_check", sql`credit_cadence = ANY (ARRAY['trial'::text, 'billing-period'::text, 'none'::text])`),
	check("commercial_plan_version_credit_owner_check", sql`credit_owner = ANY (ARRAY['user'::text, 'organization'::text])`),
	check("commercial_plan_version_existing_subscriber_policy_check", sql`existing_subscriber_policy = ANY (ARRAY['cycle-end'::text, 'new-customers-only'::text])`),
	check("commercial_plan_version_included_credits_check", sql`included_credits >= 0`),
	check("commercial_plan_version_trial_days_check", sql`trial_days > 0`),
	check("commercial_plan_version_weekly_credits_check", sql`weekly_credits >= 0`),
]);

export const mastra_ai_spans = pgTable("mastra_ai_spans", {
	traceId: text().notNull(),
	spanId: text().notNull(),
	name: text().notNull(),
	spanType: text().notNull(),
	isEvent: boolean().notNull(),
	startedAt: timestamp({ mode: 'string' }).notNull(),
	parentSpanId: text(),
	entityType: text(),
	entityId: text(),
	entityName: text(),
	userId: text(),
	organizationId: text(),
	resourceId: text(),
	runId: text(),
	sessionId: text(),
	threadId: text(),
	requestId: text(),
	environment: text(),
	source: text(),
	serviceName: text(),
	scope: jsonb(),
	metadata: jsonb(),
	tags: jsonb(),
	attributes: jsonb(),
	links: jsonb(),
	input: jsonb(),
	output: jsonb(),
	error: jsonb(),
	endedAt: timestamp({ mode: 'string' }),
	createdAt: timestamp({ mode: 'string' }).notNull(),
	updatedAt: timestamp({ mode: 'string' }),
	startedAtZ: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	endedAtZ: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	createdAtZ: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAtZ: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("mastra_ai_spans_entitytype_entityid_idx").using("btree", table.entityType.asc().nullsLast(), table.entityId.asc().nullsLast()),
	index("mastra_ai_spans_entitytype_entityname_idx").using("btree", table.entityType.asc().nullsLast(), table.entityName.asc().nullsLast()),
	index("mastra_ai_spans_metadata_gin_idx").using("gin", table.metadata.asc().nullsLast()),
	index("mastra_ai_spans_name_idx").using("btree", table.name.asc().nullsLast()),
	index("mastra_ai_spans_orgid_userid_idx").using("btree", table.organizationId.asc().nullsLast(), table.userId.asc().nullsLast()),
	index("mastra_ai_spans_parentspanid_startedat_idx").using("btree", table.parentSpanId.asc().nullsLast(), table.startedAt.desc().nullsFirst()),
	index("mastra_ai_spans_root_spans_idx").using("btree", table.startedAt.desc().nullsFirst()).where(sql`("parentSpanId" IS NULL)`),
	index("mastra_ai_spans_spantype_startedat_idx").using("btree", table.spanType.asc().nullsLast(), table.startedAt.desc().nullsFirst()),
	index("mastra_ai_spans_tags_gin_idx").using("gin", table.tags.asc().nullsLast()),
	index("mastra_ai_spans_traceid_startedat_idx").using("btree", table.traceId.asc().nullsLast(), table.startedAt.desc().nullsFirst()),
	primaryKey({ columns: [table.traceId, table.spanId], name: "public_mastra_ai_spans_traceid_spanid_pk"}),
]);

/**
 * Durable executions of the platform's fixed intelligence workflows.
 * These are product capabilities, not user-authored automations.
 */
export const intelligence_runs = pgTable("intelligence_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: text().default(organizationIdDefault).notNull(),
	workflow_key: text().notNull(),
	status: text().default('running').notNull(),
	trigger: text().notNull(),
	input: jsonb().default({}).notNull(),
	idempotency_key: text().notNull(),
	initiating_user_id: text(),
	actor_type: text().default('system').notNull(),
	error: jsonb(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	started_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	completed_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("intelligence_runs_org_time_idx").using("btree", table.organization_id.asc().nullsLast(), table.created_at.desc().nullsFirst()),
	unique("intelligence_runs_id_organization_key").on(table.id, table.organization_id),
	unique("intelligence_runs_org_workflow_idempotency_key").on(table.organization_id, table.workflow_key, table.idempotency_key),
	pgPolicy("intelligence_runs_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("intelligence_runs_actor_type_check", sql`actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])`),
	check("intelligence_runs_status_check", sql`status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])`),
	check("intelligence_runs_trigger_check", sql`trigger = ANY (ARRAY['chat'::text, 'event'::text, 'external'::text, 'system'::text])`),
]);

/** Structured, channel-neutral outputs returned by every intelligence workflow. */
export const intelligence_artifacts = pgTable("intelligence_artifacts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: text().default(organizationIdDefault).notNull(),
	run_id: uuid().notNull(),
	workflow_key: text().notNull(),
	kind: text().notNull(),
	status: text().default('ready').notNull(),
	title: text().notNull(),
	summary: text(),
	content: jsonb().notNull(),
	source_refs: jsonb().default([]).notNull(),
	recommendations: jsonb().default([]).notNull(),
	provenance: jsonb().default({}).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("intelligence_artifacts_org_time_idx").using("btree", table.organization_id.asc().nullsLast(), table.created_at.desc().nullsFirst()),
	index("intelligence_artifacts_run_idx").using("btree", table.organization_id.asc().nullsLast(), table.run_id.asc().nullsLast()),
	foreignKey({
		columns: [table.run_id, table.organization_id],
		foreignColumns: [intelligence_runs.id, intelligence_runs.organization_id],
		name: "intelligence_artifacts_run_id_fkey"
	}).onDelete("cascade"),
	unique("intelligence_artifacts_id_organization_key").on(table.id, table.organization_id),
	pgPolicy("intelligence_artifacts_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("intelligence_artifacts_status_check", sql`status = ANY (ARRAY['ready'::text, 'approved'::text, 'superseded'::text])`),
]);

/** Human decisions raised by domain events and opened in any conversation surface. */
export const attention_items = pgTable("attention_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: text().default(organizationIdDefault).notNull(),
	event_id: uuid(),
	artifact_id: uuid(),
	status: text().default('open').notNull(),
	priority: text().default('normal').notNull(),
	category: text().default('general').notNull(),
	policy_version: integer().default(1).notNull(),
	group_key: text(),
	title: text().notNull(),
	message: text().notNull(),
	entity_type: text(),
	entity_id: text(),
	suggested_action: jsonb().notNull(),
	assigned_user_id: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	resolved_at: timestamp({ withTimezone: true, mode: 'string' }),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("attention_items_org_status_time_idx").using("btree", table.organization_id.asc().nullsLast(), table.status.asc().nullsLast(), table.created_at.desc().nullsFirst()),
	uniqueIndex("attention_items_org_event_key").using("btree", table.organization_id.asc().nullsLast(), table.event_id.asc().nullsLast()).where(sql`(event_id IS NOT NULL)`),
	unique("attention_items_id_organization_key").on(table.id, table.organization_id),
	foreignKey({
		columns: [table.event_id, table.organization_id],
		foreignColumns: [product_events.id, product_events.organization_id],
		name: "attention_items_event_id_fkey"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.artifact_id, table.organization_id],
		foreignColumns: [intelligence_artifacts.id, intelligence_artifacts.organization_id],
		name: "attention_items_artifact_id_fkey"
	}).onDelete("restrict"),
	pgPolicy("attention_items_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("attention_items_priority_check", sql`priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])`),
	check("attention_items_status_check", sql`status = ANY (ARRAY['open'::text, 'seen'::text, 'resolved'::text, 'dismissed'::text])`),
]);

/** Idempotent receipts for deterministic consumers of the append-only event ledger. */
export const product_event_projections = pgTable("product_event_projections", {
	organization_id: text().default(organizationIdDefault).notNull(),
	event_id: uuid().notNull(),
	projector: text().notNull(),
	policy_version: integer().notNull(),
	outcome: text().notNull(),
	processed_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	primaryKey({ columns: [table.organization_id, table.event_id, table.projector, table.policy_version], name: "product_event_projections_pkey" }),
	index("product_event_projections_event_idx").using("btree", table.organization_id.asc().nullsLast(), table.event_id.asc().nullsLast()),
	foreignKey({
		columns: [table.event_id, table.organization_id],
		foreignColumns: [product_events.id, product_events.organization_id],
		name: "product_event_projections_event_id_fkey"
	}).onDelete("cascade"),
	pgPolicy("product_event_projections_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("product_event_projections_outcome_check", sql`outcome = ANY (ARRAY['notified'::text, 'suppressed'::text])`),
]).enableRLS();

/** Per-member lifecycle for a workspace assistant notification. */
export const notification_recipients = pgTable("notification_recipients", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: text().default(organizationIdDefault).notNull(),
	attention_item_id: uuid().notNull(),
	user_id: text().notNull(),
	status: text().default('unread').notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	delivered_at: timestamp({ withTimezone: true, mode: 'string' }),
	seen_at: timestamp({ withTimezone: true, mode: 'string' }),
	acted_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	uniqueIndex("notification_recipients_item_user_key").using("btree", table.organization_id.asc().nullsLast(), table.attention_item_id.asc().nullsLast(), table.user_id.asc().nullsLast()),
	index("notification_recipients_inbox_idx").using("btree", table.organization_id.asc().nullsLast(), table.user_id.asc().nullsLast(), table.status.asc().nullsLast(), table.created_at.desc().nullsFirst()),
	foreignKey({
		columns: [table.attention_item_id, table.organization_id],
		foreignColumns: [attention_items.id, attention_items.organization_id],
		name: "notification_recipients_attention_item_id_fkey"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.user_id],
		foreignColumns: [user.id],
		name: "notification_recipients_user_id_fkey"
	}).onDelete("cascade"),
	pgPolicy("notification_recipients_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
	check("notification_recipients_status_check", sql`status = ANY (ARRAY['unread'::text, 'seen'::text, 'dismissed'::text, 'acted'::text])`),
]).enableRLS();

/** Missing rows mean enabled; explicit rows let each member opt out by category and channel. */
export const notification_preferences = pgTable("notification_preferences", {
	organization_id: text().default(organizationIdDefault).notNull(),
	user_id: text().notNull(),
	category: text().notNull(),
	channel: text().default('in_app').notNull(),
	enabled: boolean().default(true).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	primaryKey({ columns: [table.organization_id, table.user_id, table.category, table.channel], name: "notification_preferences_pkey" }),
	foreignKey({
		columns: [table.user_id],
		foreignColumns: [user.id],
		name: "notification_preferences_user_id_fkey"
	}).onDelete("cascade"),
	pgPolicy("notification_preferences_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
]).enableRLS();

/** Replay-safe outcome reports returned by n8n or another delivery orchestrator. */
export const intelligence_artifact_outcomes = pgTable("intelligence_artifact_outcomes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organization_id: text().default(organizationIdDefault).notNull(),
	artifact_id: uuid().notNull(),
	delivery_id: text().notNull(),
	status: text().notNull(),
	channel: text(),
	external_ref: text(),
	metrics: jsonb().default({}).notNull(),
	payload: jsonb().default({}).notNull(),
	occurred_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	reported_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("intelligence_artifact_outcomes_artifact_idx").using("btree", table.organization_id.asc().nullsLast(), table.artifact_id.asc().nullsLast(), table.occurred_at.desc().nullsFirst()),
	unique("intelligence_artifact_outcomes_org_delivery_key").on(table.organization_id, table.delivery_id),
	foreignKey({
		columns: [table.artifact_id, table.organization_id],
		foreignColumns: [intelligence_artifacts.id, intelligence_artifacts.organization_id],
		name: "intelligence_artifact_outcomes_artifact_id_fkey"
	}).onDelete("cascade"),
	pgPolicy("intelligence_artifact_outcomes_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
]);

/** One HMAC signing secret per organization for the stable external API. */
export const intelligence_api_tokens = pgTable("intelligence_api_tokens", {
	organization_id: text().primaryKey().notNull(),
	token: uuid().defaultRandom().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	rotated_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	unique("intelligence_api_tokens_token_key").on(table.token),
	pgPolicy("intelligence_api_tokens_organization_policy", { as: "permissive", for: "all", to: ["public"], using: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`, withCheck: sql`(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))`  }),
]);
