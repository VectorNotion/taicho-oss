-- Recording lifecycle state now lives in private Cloudflare R2 and is owned by
-- the Modal Call Recording service. Taicho retains only its OAuth client and
-- lead-transcript evidence; these standalone-backend tables are obsolete.
DROP TABLE IF EXISTS "call_recording_jobs";
DROP TABLE IF EXISTS "call_recording_chunks";
DROP TABLE IF EXISTS "call_recording_tracks";
DROP TABLE IF EXISTS "call_recordings";
