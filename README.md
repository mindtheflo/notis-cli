# Notis CLI

The open-source source distribution for [`@notis_ai/cli`](https://www.npmjs.com/package/@notis_ai/cli), the agent-first Notis CLI for apps and generic tool execution.

[![CI](https://github.com/mindtheflo/notis-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/mindtheflo/notis-cli/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40notis_ai%2Fcli)](https://www.npmjs.com/package/@notis_ai/cli)
[![skills.sh](https://skills.sh/b/mindtheflo/notis-cli)](https://skills.sh/mindtheflo/notis-cli)

## Use it

```bash
npx --package @notis_ai/cli@latest -- notis --help
npx --package @notis_ai/cli@latest -- notis login
npx --package @notis_ai/cli@latest -- notis doctor
npx --package @notis_ai/cli@latest -- notis tools search "list Notis databases"
```

## Repository layout

- `packages/cli/` — the npm package source, tests, and generated command docs.
- `scaffolds/` — public Notis Apps starter projects bundled by the CLI.
- `skills/` — public agent skills indexed by skills.sh.
- `server/config/notis_app_boundary_rules.json` — the public app-boundary rules bundled into the package.

## Develop

```bash
cd packages/cli
npm ci
npm test
npm run smoke
```

The package is MIT-licensed. Authentication uses a scoped OAuth credential, the local Notis Desktop credential, or `NOTIS_JWT` for CI and hosted agents. Do not commit credentials or production data.

## Releases

Every pull request runs the full CLI test suite and package smoke test. A version tag such as `v0.2.1` publishes the package through the release workflow when the repository has an `NPM_TOKEN` secret.
