import { runMigrations } from "@content-automation/database/migrate";

await runMigrations();
console.info("Database migrations are current.");
