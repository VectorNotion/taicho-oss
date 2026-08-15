import { getAccountForProspect } from "./account-repository";
import { getDimensionDefinitions } from "./dimension-repository";
import {
  getAccountScore,
  getMatches,
  getObservations,
  getProspectQualification,
  getProspectScore,
} from "./qualification-repository";
import { getLegacyQualification, getProspectById } from "./prospect-repository";
import {
  qualificationIsStale,
  qualificationNarrative,
  researchFreshness,
  type DossierFitFinding,
  type ProspectDossier,
} from "../domain/prospect-dossier";
import { DEFAULT_THRESHOLDS, type DimensionMatch, type ObservationRecord } from "../domain/qualification";

type EntityRef = { kind: "account" | "prospect"; id: string };

export interface ProspectDossierDeps {
  getProspectById: typeof getProspectById;
  getLegacyQualification: typeof getLegacyQualification;
  getAccountForProspect: typeof getAccountForProspect;
  getDimensionDefinitions: typeof getDimensionDefinitions;
  getObservations: (entity: EntityRef) => Promise<ObservationRecord[]>;
  getMatches: (entity: EntityRef) => Promise<DimensionMatch[]>;
  getAccountScore: typeof getAccountScore;
  getProspectScore: typeof getProspectScore;
  getProspectQualification: typeof getProspectQualification;
  now: () => Date;
}

const defaultDeps: ProspectDossierDeps = {
  getProspectById,
  getLegacyQualification,
  getAccountForProspect,
  getDimensionDefinitions,
  getObservations,
  getMatches,
  getAccountScore,
  getProspectScore,
  getProspectQualification,
  now: () => new Date(),
};

function fitFindings(observations: ObservationRecord[], matches: DimensionMatch[]): DossierFitFinding[] {
  const matchByKey = new Map(matches.map((match) => [match.dimensionKey, match]));
  return observations
    .filter((observation) => observation.shape === "prose")
    .map((observation) => ({
      dimensionKey: observation.dimensionKey,
      observedValue: observation.observedValue,
      evidence: observation.evidence,
      confidence: observation.confidence,
      researchedAt: observation.researchedAt,
      match: matchByKey.get(observation.dimensionKey) ?? null,
    }));
}

export async function getProspectDossier(
  prospectId: string,
  deps: Partial<ProspectDossierDeps> = {},
): Promise<ProspectDossier | null> {
  const d = { ...defaultDeps, ...deps };
  const prospect = await d.getProspectById(prospectId);
  if (!prospect) return null;

  const now = d.now();
  const [
    dimensions,
    personObservations,
    personMatches,
    personScore,
    qualification,
    legacy,
    accountSummary,
  ] = await Promise.all([
    d.getDimensionDefinitions({ activeOnly: true, seedIfEmpty: false }),
    d.getObservations({ kind: "prospect", id: prospectId }),
    d.getMatches({ kind: "prospect", id: prospectId }),
    d.getProspectScore(prospectId),
    d.getProspectQualification(prospectId),
    d.getLegacyQualification(prospectId),
    d.getAccountForProspect(prospectId),
  ]);

  const personaDimensions = dimensions.filter(
    (dimension) => dimension.appliesTo === "prospect" && dimension.dimensionType === "fit",
  );
  const accountDimensions = dimensions.filter((dimension) => dimension.appliesTo === "account");
  const accountData = accountSummary
    ? await Promise.all([
        d.getObservations({ kind: "account", id: accountSummary.id }),
        d.getMatches({ kind: "account", id: accountSummary.id }),
        d.getAccountScore(accountSummary.id),
      ])
    : null;
  const [accountObservations, accountMatches, accountScore] = accountData ?? [[], [], null];
  const timingValueByKey = new Map(
    (accountScore?.timingBreakdown ?? []).map((entry) => [entry.dimensionKey, entry.dimensionValue]),
  );
  const narrative = qualificationNarrative({
    qualification,
    icpScore: accountScore?.icpScore ?? null,
    personaScore: personScore?.personaScore ?? null,
    timingScore: accountScore?.timingScore ?? null,
    thresholds: DEFAULT_THRESHOLDS,
  });
  const companyName = prospect.company?.trim() || null;

  return {
    snapshotAt: now.toISOString(),
    prospect: { id: prospect.id, name: prospect.name, companyName },
    person: {
      personaScore: personScore?.personaScore ?? null,
      hardExcluded: personScore?.hardExcluded ?? false,
      reviewReason: personScore?.reviewReason ?? null,
      computedAt: personScore?.computedAt ?? null,
      research: researchFreshness(personaDimensions, personObservations, now),
      findings: fitFindings(personObservations, personMatches),
    },
    account: accountSummary
      ? {
          id: accountSummary.id,
          name: accountSummary.name,
          prospectCount: accountSummary.prospectCount,
          qualifiedCount: accountSummary.qualifiedCount,
          isTarget: accountSummary.isTarget,
          icpScore: accountScore?.icpScore ?? null,
          timingScore: accountScore?.timingScore ?? null,
          hardExcluded: accountScore?.hardExcluded ?? false,
          reviewReason: accountScore?.reviewReason ?? null,
          computedAt: accountScore?.computedAt ?? null,
          research: researchFreshness(accountDimensions, accountObservations, now),
          fitFindings: fitFindings(accountObservations, accountMatches),
          timingFindings: accountObservations
            .filter((observation) => observation.shape === "signals")
            .map((observation) => ({
              dimensionKey: observation.dimensionKey,
              signals: observation.signals ?? [],
              evidence: observation.evidence,
              confidence: observation.confidence,
              researchedAt: observation.researchedAt,
              dimensionValue: timingValueByKey.get(observation.dimensionKey) ?? null,
              signalCount: observation.signals?.length ?? 0,
            })),
        }
      : null,
    accountResolution: {
      state: accountSummary ? "resolved" : companyName ? "available" : "unavailable",
      companyName,
    },
    qualification: {
      status: qualification?.status ?? null,
      thresholds: DEFAULT_THRESHOLDS,
      explanation: narrative.explanation,
      recommendedAction: narrative.recommendedAction,
      computedAt: qualification?.computedAt ?? null,
      isStale: qualificationIsStale(
        qualification?.computedAt,
        [personScore?.computedAt, accountScore?.computedAt],
      ),
      icpMatches: accountMatches,
      personaMatches: personMatches,
      timingBreakdown: accountScore?.timingBreakdown ?? [],
      legacy,
    },
  };
}
