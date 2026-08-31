-- Persist the exact shared-knowledge inputs used to create an intelligence
-- artifact. Outcomes can then be projected back onto the same claims instead
-- of relying on lossy source-reference strings.
ALTER TABLE "intelligence_artifacts"
  ADD COLUMN "used_claim_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "intelligence_artifacts"
  ADD COLUMN "used_evidence_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL;
