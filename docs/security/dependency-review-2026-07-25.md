# Production dependency review — 25 July 2026

Scope: the production dependency graph in `pnpm-lock.yaml`, evaluated on the
supported Node 24 toolchain with:

```bash
pnpm install --frozen-lockfile
pnpm audit --prod --audit-level high
```

## Result

The production audit moved from 31 high advisories (83 advisories overall at
the launch audit) to:

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Moderate | 1 |
| Low | 1 |

`pnpm audit --prod --audit-level high` exits successfully and is a blocking
step in `.github/workflows/docker.yml` after a frozen install. It evaluates
the full production lockfile for pull requests, pushes, and candidates. The
GitHub dependency-review action cannot run on this private repository because
GitHub Advanced Security is not purchased; an administrator attempted to
enable it and GitHub returned HTTP 422. The unavailable action is therefore
not presented as a passing control. Dependabot alerts/updates plus the
fail-closed full-lockfile audit provide the supported dependency controls.

## High-severity remediation and runtime reachability

| Chain | Runtime reachability | Resolution |
| --- | --- | --- |
| `@modelcontextprotocol/sdk` | Directly reachable in the inbound MCP server and outbound MCP client. A fresh server and transport were already created per request, but the vulnerable SDK was still in the runtime graph. | Forced to 1.29.0; MCP server, surface, and outbound-client security suites pass. |
| Hono / `@hono/node-server` | Transitive through Mastra and the MCP SDK. Hono routing is runtime code; the Node static-file adapter is installed but Taicho uses the Web Standard transport and does not call `serveStatic`. | Hono 4.12.32 and the Node adapter are forced to patched releases, including `@hono/node-server` 2.0.10. MCP runtime tests and the full Node 24 typecheck pass. |
| `path-to-regexp` | Transitive through the A2A/Express and MCP/Express router stacks. No Taicho route pattern is supplied by a customer, but the modules are runtime-reachable. | Patched 0.x and 8.x lines forced to 0.1.13 and 8.4.2. |
| Ajv / `fast-uri` | MCP request and tool-schema validation is runtime-reachable and processes remote schemas. | Ajv 8.20.0 and fast-uri 3.1.4. |
| `linkify-it` / Markdown-It | Reachable from the rich-text editor with user-authored content. | linkify-it 5.0.2 and Markdown-It 14.3.0. |
| MJML / `html-minifier` | Reachable while compiling customer-authored nurture templates, so the unpatched ReDoS chain could not be accepted. Input is already bounded to 500,000 characters at the MCP boundary. | MJML upgraded from 4.18.0 to 5.4.0, which replaces `html-minifier` with htmlnano. All 76 Cascade tests pass. |
| Babel | Build-only through Next/styled-jsx. Customer input does not reach the release compiler, but the patched version is compatible. | Forced to `@babel/core` 7.29.6; the Node 24 package and repository typechecks pass. |
| PostCSS | Next build dependency. Attacker-controlled source maps are not accepted by the release build, but the vulnerable exact Next dependency remained in the image build graph. | Forced to 8.5.23; the full production build passes. |
| Sharp | Next image-processing runtime dependency; uploaded or remote image content can reach it as features evolve. | Forced to 0.35.3; the full production build passes. |
| Picomatch / minimatch / brace-expansion | Picomatch is build tooling. Minimatch/brace-expansion are also present under OpenTelemetry cloud detection; their glob patterns are library-defined rather than customer-controlled. | Patched picomatch lines, minimatch 3.1.5/9.0.9, and brace-expansion 5.0.8. A checked-in minimatch 3 CommonJS compatibility patch preserves its callable API. Lint, observability tests, and build pass. |
| ESLint / flatted / JS-YAML | ESLint was incorrectly declared as a production dependency of the shared config package. JS-YAML remains runtime-reachable through MJML configuration discovery. | ESLint moved to `devDependencies`; runtime JS-YAML forced to 4.3.0. |

## Remaining non-blocking findings

| Severity | Finding | Reachability and control | Review date |
| --- | --- | --- | --- |
| Moderate | Better Auth OAuth provider does not bind resource indicators before 1.7.0-beta.4. | The OAuth provider is runtime-reachable. There is no patched stable release; production uses one canonical MCP resource and authorization issuer. Do not enable arbitrary resource indicators. Upgrade after a compatible stable Better Auth release and rerun OAuth consent/token tests. | 15 August 2026 |
| Low | AI SDK provider utilities can consume unbounded resources in an old Mastra compatibility path. | The affected provider-v4 compatibility path is not selected by Taicho's AI SDK v6 runtime. No patched release exists in the reported chain. Provider request/body/time limits remain required. | 15 August 2026 |

These are engineering risk records, not authorization to weaken the high or
critical gate. Any new high/critical finding blocks the release until patched
or explicitly accepted by the accountable security owner with an expiry date.

## Verification evidence

- Node 24 canonical typecheck: all supported package targets passed.
- `pnpm lint`: passed (existing warnings only).
- Observability: 14 passed, 1 database test skipped by its explicit opt-in.
- Platform: 30 passed, 1 database test skipped by its explicit opt-in.
- MCP: 9 passed, 2 database/live integration tests skipped by their explicit
  opt-ins.
- Cascade/MJML: 76 of 76 passed.
- Unified production build: all 91 routes compiled, typechecked, and collected.

The database-backed skips are covered by the canonical database-enabled CI
lane; P0-05 remains open until the patched image is published and deployed by
that release pipeline.
