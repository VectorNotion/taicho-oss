-- Dashboard sessions call /api/v1 under synthetic "session:<userId>" client
-- ids that have no oauthClient row, so the rate-limit table can no longer
-- enforce a foreign key to oauthClient. Row cleanup was already handled by
-- expiry pruning (expires_at), not by the cascade this constraint provided.
ALTER TABLE "external_api_rate_limit"
	DROP CONSTRAINT IF EXISTS "external_api_rate_limit_oauth_client_fk";
