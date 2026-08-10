-- Call Recording is a first-party public OAuth client, not an identity system.
-- The client has no user or organization owner. Every issued grant is bound by
-- Taicho OAuth to the consenting Taicho user and selected organization.
--
-- This registration intentionally lives after the recording schema migration:
-- 0013 reached development databases before the client registration was added.
INSERT INTO "oauthClient" (
	"id",
	"clientId",
	"disabled",
	"skipConsent",
	"scopes",
	"redirectUris",
	"tokenEndpointAuthMethod",
	"grantTypes",
	"responseTypes",
	"public",
	"type",
	"requirePKCE",
	"referenceId",
	"metadata",
	"createdAt",
	"updatedAt"
) VALUES (
	'taicho-call-recording-native-v1',
	'taicho-call-recording-native-v1',
	false,
	false,
	'["openid","profile","email","offline_access","vn:outreach:read","vn:outreach:write"]'::jsonb,
	'["taicho-call-recording://oauth/callback"]'::jsonb,
	'none',
	'["authorization_code","refresh_token"]'::jsonb,
	'["code"]'::jsonb,
	true,
	'native',
	true,
	NULL,
	'{"first_party":true,"allowed_resources":["api"]}'::jsonb,
	now(),
	now()
)
ON CONFLICT ("clientId") DO UPDATE SET
	"disabled" = EXCLUDED."disabled",
	"skipConsent" = EXCLUDED."skipConsent",
	"scopes" = EXCLUDED."scopes",
	"redirectUris" = EXCLUDED."redirectUris",
	"tokenEndpointAuthMethod" = EXCLUDED."tokenEndpointAuthMethod",
	"grantTypes" = EXCLUDED."grantTypes",
	"responseTypes" = EXCLUDED."responseTypes",
	"public" = EXCLUDED."public",
	"type" = EXCLUDED."type",
	"requirePKCE" = EXCLUDED."requirePKCE",
	"referenceId" = EXCLUDED."referenceId",
	"metadata" = EXCLUDED."metadata",
	"updatedAt" = now();
