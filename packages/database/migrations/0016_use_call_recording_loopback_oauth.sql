-- Native OAuth uses the RFC 8252 loopback redirect pattern. Better Auth treats
-- an exact 127.0.0.1 host and path as registered while allowing the desktop to
-- choose an ephemeral port for each authorization attempt.
UPDATE "oauthClient"
SET
	"redirectUris" = '["http://127.0.0.1/oauth/callback"]'::jsonb,
	"updatedAt" = now()
WHERE "clientId" = 'taicho-call-recording-native-v1';
