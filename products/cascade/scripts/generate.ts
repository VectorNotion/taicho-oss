import { parseArgs } from "node:util";
import { getCascadePool } from "../data/pool";
import { OpenRouterLlm } from "../agent/llm";
import { generateContentVariants } from "../agent/content-agent";
import { validateVariant } from "../agent/validate";

// Offline agent entry point (ADR 0001): generate draft variants for a step,
// run the validation gate, and leave them for approval.
//   pnpm --filter @content-automation/cascade agent:generate -- \
//     --step <step-id> --template <template-id> --from hello@mail.example.com \
//     --count 3 --briefing "Onboarding welcome" [--interest-url https://...]
const { values } = parseArgs({
  options: {
    step: { type: "string" },
    template: { type: "string" },
    from: { type: "string" },
    count: { type: "string", default: "3" },
    briefing: { type: "string", default: "" },
    "interest-url": { type: "string" },
  },
});

if (!values.step || !values.template || !values.from) {
  console.error("required: --step <id> --template <id> --from <email>");
  process.exit(1);
}

const pool = getCascadePool();
const created = await generateContentVariants(pool, new OpenRouterLlm(), {
  stepId: values.step,
  count: Number(values.count),
  briefing: values.briefing ?? "",
  templateId: values.template,
  fromEmail: values.from,
  interestUrl: values["interest-url"],
});

for (const item of created) {
  const validation = await validateVariant(pool, item.variantId);
  console.log(
    `variant ${item.variantId}: ${validation.ok ? "validated (awaiting approval)" : `rejected: ${validation.errors.join("; ")}`}`,
  );
}
await pool.end();
