import type { CreateDimensionInput } from "../domain/qualification";

/**
 * Seed dimensions from docs/icp-update-v2.md §4 (ICP), §5 (Persona), §6 (Timing).
 * Instructions and ideal values are taken from the spec; weights, half-lives and
 * freshness windows use the spec's figures where given (§4, §6, §14).
 */
export const DEFAULT_DIMENSIONS: CreateDimensionInput[] = [
  // ─── ICP: account × fit ───────────────────────────────────────────────
  {
    key: "internal_ai_capability",
    name: "Internal AI Capability",
    dimensionType: "fit",
    appliesTo: "account",
    researchInstruction:
      "Determine whether the company has meaningful internal AI/ML capability. Investigate employees, leadership, products, current and historical job postings and public AI initiatives.",
    idealValue:
      "The company has little or no dedicated internal AI/ML engineering capability and is not building an AI-native product.",
    weight: 0.25,
    freshnessWindowDays: 120,
    hardExclusionRule:
      "The company is currently hiring substantive AI/ML engineering roles and research confirms an internal AI build-out.",
    isActive: true,
  },
  {
    key: "internal_engineering_capability",
    name: "Internal Engineering Capability",
    dimensionType: "fit",
    appliesTo: "account",
    researchInstruction:
      "Determine whether the company has enough technical sophistication to consume solutions without having such a large engineering organization that external implementation becomes unnecessary.",
    idealValue:
      "Technically competent organization with limited internal capacity to build sophisticated AI systems itself.",
    weight: 0.15,
    freshnessWindowDays: 180,
    isActive: true,
  },
  {
    key: "operational_scale",
    name: "Operational Scale",
    dimensionType: "fit",
    appliesTo: "account",
    researchInstruction:
      "Determine whether the organization contains sufficiently large business operations. Consider employee count, sales headcount, support headcount, operations teams, compliance teams and customer-facing workforce.",
    idealValue:
      "Operationally large organization with substantial sales, support, operations or compliance teams.",
    weight: 0.2,
    freshnessWindowDays: 180,
    isActive: true,
  },
  {
    key: "human_process_intensity",
    name: "Human Process Intensity",
    dimensionType: "fit",
    appliesTo: "account",
    researchInstruction:
      "Determine whether meaningful workflows rely on repeated human work, knowledge work, analysis, review, communication or operational coordination.",
    idealValue:
      "Core business processes depend heavily on repeated human knowledge work, review, communication or coordination.",
    weight: 0.2,
    freshnessWindowDays: 180,
    isActive: true,
  },
  {
    key: "economic_capacity",
    name: "Economic Capacity",
    dimensionType: "fit",
    appliesTo: "account",
    researchInstruction:
      "Research economic indicators: company scale, revenue, funding, recent funding rounds, investment activity and business maturity.",
    idealValue:
      "Mature or well-funded business with the economic capacity to purchase external AI capability.",
    weight: 0.2,
    freshnessWindowDays: 120,
    isActive: true,
  },

  // ─── Persona: prospect × fit ──────────────────────────────────────────
  {
    key: "decision_authority",
    name: "Decision Authority",
    dimensionType: "fit",
    appliesTo: "prospect",
    researchInstruction:
      "Determine whether the person has sufficient authority or influence to initiate, sponsor or approve an engagement. Research actual responsibility and authority, not title alone.",
    idealValue:
      "Senior leader with clear authority or strong influence to initiate, sponsor or approve an external engagement.",
    weight: 0.2,
    freshnessWindowDays: 180,
    isActive: true,
  },
  {
    key: "problem_ownership",
    name: "Problem Ownership",
    dimensionType: "fit",
    appliesTo: "prospect",
    researchInstruction:
      "Determine whether this person directly owns a business function where the offered solution could create measurable impact (sales, operations, compliance, support, finance operations, customer success, transformation).",
    idealValue:
      "Directly owns a substantial business function where AI capability creates measurable impact.",
    weight: 0.2,
    freshnessWindowDays: 180,
    isActive: true,
  },
  {
    key: "scale_of_responsibility",
    name: "Scale of Responsibility",
    dimensionType: "fit",
    appliesTo: "prospect",
    researchInstruction:
      "Determine whether the person manages a sufficiently large process, team, budget or business function.",
    idealValue: "Manages a large process, team, budget or business function.",
    weight: 0.15,
    freshnessWindowDays: 180,
    isActive: true,
  },
  {
    key: "change_mandate",
    name: "Change Mandate",
    dimensionType: "fit",
    appliesTo: "prospect",
    researchInstruction:
      "Determine whether this person is responsible for efficiency, growth, transformation, automation, productivity, revenue improvement or operational performance.",
    idealValue:
      "Holds an explicit mandate for efficiency, growth, transformation, automation or operational performance.",
    weight: 0.15,
    freshnessWindowDays: 180,
    isActive: true,
  },
  {
    key: "budget_proximity",
    name: "Budget Proximity",
    dimensionType: "fit",
    appliesTo: "prospect",
    researchInstruction:
      "Determine whether the person can control budget, influence a budget owner, sponsor a purchase, or bring the economic buyer into the process.",
    idealValue:
      "Controls budget or can directly bring the economic buyer into the process.",
    weight: 0.1,
    freshnessWindowDays: 180,
    isActive: true,
  },
  {
    key: "external_solution_fit",
    name: "External Solution Fit",
    dimensionType: "fit",
    appliesTo: "prospect",
    researchInstruction:
      "Determine whether this person is likely to buy external capability rather than treat the engagement as additional internal development labour.",
    idealValue:
      "Likely to purchase external AI capability rather than build internally.",
    weight: 0.1,
    freshnessWindowDays: 180,
    isActive: true,
  },
  {
    key: "technical_builder_conflict",
    name: "Technical Builder Conflict",
    dimensionType: "fit",
    appliesTo: "prospect",
    researchInstruction:
      "Determine whether the prospect is primarily an internal technical builder (ML Engineer, AI Engineer, Applied Scientist, Senior Software Engineer) rather than a business or operational leader. Titles alone must not decide — research actual responsibility.",
    idealValue:
      "A business or operational leader, not primarily an internal technical builder.",
    weight: 0.1,
    freshnessWindowDays: 180,
    isActive: true,
  },

  // ─── Timing: account × timing ─────────────────────────────────────────
  {
    key: "hiring_activity",
    name: "Hiring Activity",
    dimensionType: "timing",
    appliesTo: "account",
    researchInstruction:
      "List current and recent job postings relevant to sales, operations and business development. Include the posting date of every signal. Hiring type matters more than raw count; AI/ML engineering postings belong to internal_ai_capability, not here.",
    weight: 0.35,
    halfLifeDays: 45,
    freshnessWindowDays: 14,
    isActive: true,
  },
  {
    key: "leadership_public_posts",
    name: "Leadership Public Posts",
    dimensionType: "timing",
    appliesTo: "account",
    researchInstruction:
      "Find founder or executive public posts indicating operational pain, growth intent, efficiency pressure, or AI interest/confusion. Include the post date of every signal.",
    weight: 0.25,
    halfLifeDays: 21,
    freshnessWindowDays: 7,
    isActive: true,
  },
  {
    key: "funding_events",
    name: "Funding Events",
    dimensionType: "timing",
    appliesTo: "account",
    researchInstruction:
      "Find recent funding rounds and announced investment activity. Include the announcement date of every signal.",
    weight: 0.25,
    halfLifeDays: 90,
    freshnessWindowDays: 30,
    isActive: true,
  },
  {
    key: "expansion_signals",
    name: "Expansion Signals",
    dimensionType: "timing",
    appliesTo: "account",
    researchInstruction:
      "Find expansion signals: new markets, new offices, new product lines, publicized growth. Include the announcement date of every signal.",
    weight: 0.15,
    halfLifeDays: 60,
    freshnessWindowDays: 30,
    isActive: true,
  },
];
