# Contributing

Thanks for your interest in improving Content Automation.

## How changes land

This repository is a build-verified mirror of a private source-of-truth monorepo. The flow for external contributions:

1. Open a PR here as usual — CI runs the full open-core build, tests, and the architecture contracts.
2. A maintainer reviews it here. Accepted diffs are applied to the private repository.
3. The next sync mirrors your change back; your PR is closed as merged-via-sync and your authorship is preserved in the applied patch.

Please keep PRs focused and include tests where behavior changes. The architecture contracts under `tests/architecture/` are hard gates — `pnpm test:architecture` must stay green, including the open-core boundary (nothing in this repository may import the commercial packages).

## Development

Follow the Quickstart in `README.md`. Useful commands:

```bash
pnpm test:architecture   # contract tests, fast
pnpm build:content       # build the Content Generator app
pnpm build:outreach      # build the Outreach app
pnpm test                # full open-core test suite (needs docker compose up)
```

## Contributor License Agreement

A CLA is required so contributed code can also ship in the managed cloud build. The CLA bot will prompt on your first PR — signing is a one-time GitHub action.
