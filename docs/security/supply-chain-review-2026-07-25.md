# Supply-chain security review — 25 July 2026

## Scope and release decision

This review covers committed-secret detection, static application security
analysis, full-lockfile dependency auditing, container vulnerability scanning, build
attestations, image signing, and production verification for all eight release
images.

The controls are implemented and the pull-request security lane has passed,
but SEC-07 remains open. Completion requires a green release-candidate run from
the default branch, successful registry signature storage and verification,
and positive production-host verification of the signed digests. The
historical credential described below has been retired from every active
store.

## Blocking controls

The canonical `.github/workflows/docker.yml` pipeline now fails closed on:

- Gitleaks scanning with complete checkout history for accurate commit-range
  analysis;
- CodeQL `javascript-typescript` analysis with the `security-extended` query
  suite, a repository-owned SARIF gate that rejects high-confidence
  error/high/critical findings, and retained SARIF evidence;
- high/critical production dependency advisories across the frozen lockfile;
- high/critical operating-system and library findings in each exact image
  digest;
- generation and non-empty inspection of BuildKit SBOM and provenance
  attestations;
- keyless Cosign signing with the GitHub Actions OIDC workflow identity;
- immediate Cosign verification of each signed digest; and
- candidate-manifest creation only after security, test, browser,
  live-provider, image, and integrity gates all succeed on `main`.

Every third-party GitHub Action used by the new controls is pinned to a full
commit. The legacy `deploy-unified.yml` path, which published a mutable
`latest` image without those gates, has been removed.

GitHub-hosted Code Scanning cannot accept SARIF uploads for this private
repository because Advanced Security is not purchased. The official CodeQL
action still builds the database and runs the pinned query suite; upload is
disabled explicitly, `scripts/check-codeql-sarif.mjs` fails closed on malformed
output and high-confidence error/high/critical results (security score 7.0 or
higher), and the complete SARIF directory is retained as the `codeql-sarif`
workflow artifact. Medium-confidence and lower-severity results remain visible
for disposition in that artifact. This is a blocking local-SARIF control, not
a claim that the unavailable GitHub code-scanning dashboard is active.

The first working SARIF gate reported 14 results. Ten high-confidence results
were rooted in regex-based HTML and CSS handling. Those paths now use a
parser-backed HTML allowlist, parsed CSS removal for network-capable rules and
declarations, sandbox/CSP containment, and escaped text rendering. The OAuth
callback also consumes and validates its one-time state before provider-error
handling and no longer reflects the provider's error string. The security job
in workflow run `30147424926`, on commit `24cad9b`, then passed with three
reported findings and zero blocking high-confidence error/high/critical
findings; its complete `codeql-sarif` artifact is retained. The three
medium-confidence results are two callback presence guards that run only after
one-time state validation and one test-only regular expression. They remain
visible for review and are not treated as silently suppressed production
vulnerabilities.

Production promotion consumes the CI digest evidence, checks the recorded
certificate identity and issuer, pulls the commit-addressed image, verifies the
pulled digest, and runs Cosign verification again before any migration or
service restart.

The production host now runs the checksum-verified official Cosign 3.0.6
`linux/amd64` binary. A negative production-host probe rejected the deployed
legacy unsigned image, proving that the verifier fails closed without affecting
the running container. The first signed candidate must still prove positive
verification against the private registry.

## Historical secret finding

A full-history Gitleaks audit found one material secret-shaped value:

- commit: `48b1efd29b2e947213864e6fb86b2cd2b50eb077`
- path: `.mcp.json`
- key: `mcpServers.cms.env.MCP_API_KEY`
- classification: 64-character, high-entropy, non-placeholder value

The value is intentionally not reproduced in this report, logs, configuration,
or an allowlist. The current `.mcp.json` references `MCP_API_KEY` without
embedding a value.

Resolution (25 July 2026): the old client targeted the local CMS receiver at
`http://localhost:3001/api/mcp/mcp`. The receiver is decommissioned, that path
returns HTTP 404 even when probed with the historical value, and port 3001 now
belongs to an unrelated local FalkorDB UI. The historical value matched a
stale local `CMS_MCP_API_KEY`; it was removed. Production, GitHub Actions, the
CMS workspace, and the current MCP client contain no active copy, and no
replacement was issued because the integration remains disabled. The record is
therefore classified as removed rather than compromised. No Git history
rewrite was performed; the retired value remains detectable by full-history
audit and must never be allowlisted as an active credential.

## Verification still required

- Keep the pull-request Gitleaks and CodeQL jobs green; retain the
  `codeql-sarif` artifact for review of all nonblocking findings.
- Dispatch a release candidate from `main` and retain all eight Trivy, SBOM,
  provenance, Cosign, digest, and manifest artifacts.
- Confirm the registry stores signatures for every image digest.
- Confirm the first signed candidate passes production-host verification
  against the private registry.
- Retain the retired-key evidence and coordinate history cleanup only if the
  repository exposure policy later requires it.

## References

- GitHub CodeQL advanced setup:
  <https://docs.github.com/en/code-security/code-scanning/creating-an-advanced-setup-for-code-scanning>
- Sigstore container signing:
  <https://docs.sigstore.dev/cosign/signing/signing_with_containers/>
- Docker Buildx attestation inspection:
  <https://docs.docker.com/reference/cli/docker/buildx/imagetools/inspect/>
