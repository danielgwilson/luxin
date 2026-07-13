# luxin@VERSION

## Package

- npm package: `luxin-cli@VERSION`
- public repo commit: `PUBLIC_REPO_COMMIT`
- publish workflow run: `PUBLISH_WORKFLOW_URL`
- npm tarball: `NPM_TARBALL_URL`
- npm integrity: `NPM_DIST_INTEGRITY`
- npm attestation URL: `NPM_ATTESTATION_URL`

## Public Contracts

- Skill: `https://luxin.sh/skill.md`
- LLM contract: `https://luxin.sh/llms.txt`
- CLI contract: `https://luxin.sh/cli.md`
- Command manifest: `https://luxin.sh/commands.json`
- Hosted API health: `https://api.luxin.sh/healthz`

## What Changed

- SUMMARIZE_AGENT_VISIBLE_CHANGE

## Verification

Agents can verify this release with:

```bash
npm view luxin-cli@VERSION version gitHead dist.integrity dist.tarball dist.attestations.url repository.url --json
git ls-remote https://github.com/danielgwilson/luxin.git
npm exec --yes --package luxin@VERSION -- luxin version --json
npm exec --yes --package luxin@VERSION -- luxin doctor --json
```

`gitHead` from npm metadata is the source commit for the published package.
Public repo `main` may be newer than the package if docs or skill contracts
synced after the release.

## Known Status

- npm trusted publishing: EXPECTED_PRESENT
- npm provenance: EXPECTED_PRESENT
- public repo release mapping: THIS_RELEASE
- hosted contract compatibility: VERIFIED_OR_LINK
