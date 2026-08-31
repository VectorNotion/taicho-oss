CREATE TABLE "knowledge_module_manifest" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "module_key" text NOT NULL,
  "version" integer NOT NULL,
  "manifest" jsonb NOT NULL,
  "digest" text NOT NULL,
  "signature" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "knowledge_module_manifest_org_module_key" UNIQUE("organization_id", "module_key"),
  CONSTRAINT "knowledge_module_manifest_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade,
  CONSTRAINT "knowledge_module_manifest_version_check" CHECK (version > 0)
);
--> statement-breakpoint
CREATE INDEX "knowledge_module_manifest_org_enabled_idx" ON "knowledge_module_manifest" USING btree ("organization_id", "enabled");
--> statement-breakpoint
ALTER TABLE "knowledge_module_manifest" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "knowledge_module_manifest_organization_policy" ON "knowledge_module_manifest"
  AS PERMISSIVE FOR ALL TO public
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capability_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "knowledge_module_manifest" TO capability_app;
  END IF;
END $$;
