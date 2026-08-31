-- Page guides describe product features, not workspace-owned data. Consolidate
-- any receipts a user accumulated in different workspaces into one global
-- user/guide record before removing the tenant key. NO FORCE lets the owning
-- migration role read the old forced-RLS table for this transactional copy;
-- long-running roles remain subject to its existing policy until it is dropped.
ALTER TABLE "page_guide_receipts" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE TABLE "page_guide_receipts_global" (
	"user_id" text NOT NULL,
	"guide_key" text NOT NULL,
	"last_seen_content_hash" varchar(64) NOT NULL,
	"dismissed_content_hash" varchar(64),
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed_at" timestamp with time zone,
	"open_count" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_guide_receipts_global_pkey" PRIMARY KEY("user_id", "guide_key"),
	CONSTRAINT "page_guide_receipts_global_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "page_guide_receipts_global_last_seen_hash_check" CHECK (last_seen_content_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "page_guide_receipts_global_dismissed_hash_check" CHECK (dismissed_content_hash IS NULL OR dismissed_content_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "page_guide_receipts_global_dismissed_at_check" CHECK ((dismissed_content_hash IS NULL) = (dismissed_at IS NULL)),
	CONSTRAINT "page_guide_receipts_global_open_count_check" CHECK (open_count > 0)
);--> statement-breakpoint

WITH latest_seen AS (
	SELECT DISTINCT ON ("user_id", "guide_key")
		"user_id",
		"guide_key",
		"last_seen_content_hash"
	FROM "page_guide_receipts"
	ORDER BY "user_id", "guide_key", "last_seen_at" DESC, "updated_at" DESC, "organization_id"
), latest_dismissal AS (
	SELECT DISTINCT ON ("user_id", "guide_key")
		"user_id",
		"guide_key",
		"dismissed_content_hash",
		"dismissed_at"
	FROM "page_guide_receipts"
	WHERE "dismissed_content_hash" IS NOT NULL
	ORDER BY "user_id", "guide_key", "dismissed_at" DESC, "updated_at" DESC, "organization_id"
), rollup AS (
	SELECT
		"user_id",
		"guide_key",
		min("first_seen_at") AS "first_seen_at",
		max("last_seen_at") AS "last_seen_at",
		least(sum("open_count"), 2147483647)::integer AS "open_count",
		max("updated_at") AS "updated_at"
	FROM "page_guide_receipts"
	GROUP BY "user_id", "guide_key"
)
INSERT INTO "page_guide_receipts_global" (
	"user_id",
	"guide_key",
	"last_seen_content_hash",
	"dismissed_content_hash",
	"first_seen_at",
	"last_seen_at",
	"dismissed_at",
	"open_count",
	"updated_at"
)
SELECT
	rollup."user_id",
	rollup."guide_key",
	latest_seen."last_seen_content_hash",
	latest_dismissal."dismissed_content_hash",
	rollup."first_seen_at",
	rollup."last_seen_at",
	latest_dismissal."dismissed_at",
	rollup."open_count",
	rollup."updated_at"
FROM rollup
JOIN latest_seen USING ("user_id", "guide_key")
LEFT JOIN latest_dismissal USING ("user_id", "guide_key");--> statement-breakpoint

DROP TABLE "page_guide_receipts";--> statement-breakpoint
ALTER TABLE "page_guide_receipts_global" RENAME TO "page_guide_receipts";--> statement-breakpoint
ALTER TABLE "page_guide_receipts" RENAME CONSTRAINT "page_guide_receipts_global_pkey" TO "page_guide_receipts_pkey";--> statement-breakpoint
ALTER TABLE "page_guide_receipts" RENAME CONSTRAINT "page_guide_receipts_global_user_id_fkey" TO "page_guide_receipts_user_id_fkey";--> statement-breakpoint
ALTER TABLE "page_guide_receipts" RENAME CONSTRAINT "page_guide_receipts_global_last_seen_hash_check" TO "page_guide_receipts_last_seen_hash_check";--> statement-breakpoint
ALTER TABLE "page_guide_receipts" RENAME CONSTRAINT "page_guide_receipts_global_dismissed_hash_check" TO "page_guide_receipts_dismissed_hash_check";--> statement-breakpoint
ALTER TABLE "page_guide_receipts" RENAME CONSTRAINT "page_guide_receipts_global_dismissed_at_check" TO "page_guide_receipts_dismissed_at_check";--> statement-breakpoint
ALTER TABLE "page_guide_receipts" RENAME CONSTRAINT "page_guide_receipts_global_open_count_check" TO "page_guide_receipts_open_count_check";
