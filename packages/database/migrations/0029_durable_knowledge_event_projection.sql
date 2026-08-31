-- Replay-safe internal product events are the durable handoff to the shared
-- knowledge projector. Restricted event payloads remain tenant-scoped; the
-- control-plane role can discover only identifiers and ordering columns.
ALTER TABLE "product_events" ADD COLUMN "idempotency_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "product_events_internal_idempotency_key"
ON "product_events" USING btree ("organization_id", "name", "idempotency_key")
WHERE (idempotency_key IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "product_event_projections"
DROP CONSTRAINT "product_event_projections_outcome_check";
--> statement-breakpoint
ALTER TABLE "product_event_projections"
ADD CONSTRAINT "product_event_projections_outcome_check"
CHECK (outcome = ANY (ARRAY[
  'notified'::text,
  'suppressed'::text,
  'projected'::text,
  'ignored'::text
]));
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobs_admin') THEN
    GRANT SELECT ("id", "organization_id", "name", "occurred_at")
      ON TABLE "product_events" TO jobs_admin;
    GRANT SELECT ("organization_id", "event_id", "projector", "policy_version")
      ON TABLE "product_event_projections" TO jobs_admin;
  END IF;
END $$;
