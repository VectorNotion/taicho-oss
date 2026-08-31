-- The release migrator is current_user and therefore owns the schema. Runtime
-- and control access is reconciled centrally after every migration chain.
CREATE SCHEMA IF NOT EXISTS "automation";
