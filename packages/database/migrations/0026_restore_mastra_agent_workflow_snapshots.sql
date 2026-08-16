-- Mastra's bounded agent/tool loop persists its run snapshot here. This table
-- was removed with the retired automation schema, but it is runtime state for
-- the current first-class Chat agent rather than a retired product workflow.
CREATE TABLE IF NOT EXISTS "mastra_workflow_snapshot" (
	"workflow_name" text NOT NULL,
	"run_id" text NOT NULL,
	"resourceId" text,
	"snapshot" jsonb NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"createdAtZ" timestamp with time zone DEFAULT now(),
	"updatedAtZ" timestamp with time zone DEFAULT now(),
	CONSTRAINT "public_mastra_workflow_snapshot_workflow_name_run_id_key" UNIQUE("workflow_name", "run_id")
);
