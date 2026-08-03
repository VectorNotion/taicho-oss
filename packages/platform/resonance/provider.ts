/**
 * The resonance seam. Open-core code (the content drafts experience) submits
 * runs through this provider instead of importing the resonance service
 * client. The default provider reports the capability as unavailable — the
 * self-hosted answer, since scoring runs on the managed GPU worker. The cloud
 * deployment installs the real lifecycle at boot via
 * `@content-automation/resonance/register`.
 */
export interface ResonanceRunsProvider {
  handleCreateRun(request: Request): Promise<Response>;
}

class UnavailableResonanceProvider implements ResonanceRunsProvider {
  async handleCreateRun(): Promise<Response> {
    return Response.json(
      {
        error:
          "Audience Resonance is not available on this deployment. Scoring runs on the managed cloud service.",
        code: "RESONANCE_UNAVAILABLE",
      },
      { status: 501 },
    );
  }
}

let activeProvider: ResonanceRunsProvider = new UnavailableResonanceProvider();

export function setResonanceRunsProvider(provider: ResonanceRunsProvider) {
  activeProvider = provider;
}

export const handleCreateRun: ResonanceRunsProvider["handleCreateRun"] = (request) =>
  activeProvider.handleCreateRun(request);
