-- The shared knowledge adapters run through the existing tenant-scoped jobs
-- and capability database roles. Grant only the tables each role needs; RLS
-- remains forced and every query still sets app.organization_id.
DO $$
DECLARE
  runtime_role text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobs_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      "metric_ingest_tokens",
      "post_metric_snapshots"
    TO jobs_app;
  END IF;

  FOREACH runtime_role IN ARRAY ARRAY['capability_app', 'mcp_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "knowledge_module_manifest" TO %I',
        runtime_role
      );
    END IF;
  END LOOP;
END $$;
