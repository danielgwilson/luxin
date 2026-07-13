# Security

`luxin` is a single-file Node.js CLI with a deliberately small attack
surface. This document states the package's supply-chain posture so reviewers
and automated scanners can verify it directly.

## Supply-Chain Posture

- **Zero third-party dependencies.** `package.json` declares no `dependencies`,
  `devDependencies`, `optionalDependencies`, `peerDependencies`, or
  `bundledDependencies`. There is no dependency tree to audit, and
  `npm audit` reports 0 vulnerabilities.
- **No install/postinstall scripts.** `package.json` declares no `scripts`
  field, so nothing executes on `npm install` / `npx`.
- **Node built-ins only.** The entire runtime is one file,
  `bin/luxin.mjs`, and it imports only Node.js built-in modules
  (`node:crypto`, `node:fs`, `node:fs/promises`, `node:path`, `node:stream`,
  `node:stream/promises`, `node:os`). It bundles no native bindings.
- **MIT licensed**, published from GitHub Actions via npm OIDC trusted
  publishing (no long-lived npm token), with SLSA build provenance.

## Verify Provenance

The published package carries npm registry attestations, including SLSA
provenance. For any version `VERSION`:

```bash
npm view luxin-cli@VERSION dist.attestations --json
```

Attestations are also served directly by the registry:

```text
https://registry.npmjs.org/-/npm/v1/attestations/image-skill@VERSION
```

For the current dist-tag, read the live attestation URL from npm metadata:

```bash
npm view luxin-cli@latest dist.attestations.url --json
```

For an agent-readable trust packet that combines npm metadata, hosted contract
hashes, API health, model availability, and safe commands, run:

```bash
npm_config_update_notifier=false npx -y luxin-cli@latest trust --json
```

The `trust` command is read-only selection evidence: it does not read saved
auth config, print tokens, call providers, create jobs, create payment objects,
or spend credits.

## Credential Handling

The CLI never logs bearer tokens or Stripe secrets. When a command accepts a
token, prefer `--token-stdin` over passing it as an argument, and store tokens
in a secret store. Never pass live x402 payment headers, wallet keys, seed
phrases, or Stripe secret keys to any command.

## Reporting

If you find a security issue, please report it privately to
`daniel@danielgwilson.com` rather than opening a public issue. Include the npm
version, the command, and a trace ID if one was returned.
