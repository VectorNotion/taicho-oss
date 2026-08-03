import { getCascadePool } from "../data/pool";
import { OpenRouterLlm } from "../agent/llm";
import { runOptimizer } from "../agent/optimizer";

// Offline optimizer entry point (ADR 0001): run nightly/weekly via cron.
// Reads per-variant performance, retires losers, breeds the next generation.
const pool = getCascadePool();
const result = await runOptimizer(pool, new OpenRouterLlm());
console.log(`retired: ${result.retired.length} variant(s)`);
console.log(`bred:    ${result.bred.length} variant(s)`);
for (const id of result.retired) console.log(`  retired ${id}`);
for (const id of result.bred) console.log(`  bred    ${id}`);
await pool.end();
