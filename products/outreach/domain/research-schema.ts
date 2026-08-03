import { z } from 'zod';

/**
 * Schema for a company insight extracted from research.
 */
export const companyInsightSchema = z.object({
  category: z.enum(['overview', 'products', 'culture', 'recent_news', 'ai_initiatives']),
  content: z.string().describe('2-3 sentence summary of the insight'),
  sourceUrl: z.string().optional().describe('Source URL for the insight'),
});

export type CompanyInsight = z.infer<typeof companyInsightSchema>;

/**
 * Schema for competitor information.
 */
export const competitorSchema = z.object({
  name: z.string().describe('Competitor company name'),
  relevance: z.string().describe('Why this competitor is relevant'),
  aiFocus: z.string().optional().describe('Their AI/automation initiatives if any'),
});

export type CompetitorInfo = z.infer<typeof competitorSchema>;

/**
 * Complete lead research result schema.
 */
export const leadResearchSchema = z.object({
  industry: z.string().describe('The industry the company operates in'),
  companySummary: z.string().describe('2-3 sentence summary of the company'),
  companyInsights: z.array(companyInsightSchema).describe('3-5 key insights about the company'),
  competitors: z.array(competitorSchema).describe('Up to 3 main competitors'),
  talkingPoints: z.array(z.string()).describe('3-5 conversation starters for outreach'),
  outreachAngle: z.string().describe('Recommended approach for initial contact'),
});

export type LeadResearchResult = z.infer<typeof leadResearchSchema>;

/**
 * Input schema for the research action.
 */
export const researchInputSchema = z.object({
  leadId: z.string(),
  name: z.string(),
  company: z.string(),
  title: z.string().optional(),
  location: z.string().optional(),
});

export type ResearchInput = z.infer<typeof researchInputSchema>;
