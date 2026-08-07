# Notis CLI

[![CI](https://github.com/mindtheflo/notis-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/mindtheflo/notis-cli/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@notis_ai/cli)](https://www.npmjs.com/package/@notis_ai/cli)

Agent-first command-line interface for building Notis apps and running connected tools.

```bash
npx --yes --package @notis_ai/cli@latest -- notis doctor
npx --yes --package @notis_ai/cli@latest -- notis apps init
npx --yes --package @notis_ai/cli@latest -- notis tools search "list today's calendar events"
```

## Development

```bash
cd packages/cli
npm install
npm test
npm run smoke
```

This repository is an automated public mirror of `packages/cli` and its required build contracts from the private Notis monorepo. Changes are generated from the monorepo; open issues here, but do not edit mirrored files directly.

## Related repositories

- [Notis SDK](https://github.com/mindtheflo/notis-sdk)
- [Notis Skills](https://github.com/mindtheflo/notis-skills)
- [Notis Apps](https://github.com/mindtheflo/notis-apps)

MIT licensed.
