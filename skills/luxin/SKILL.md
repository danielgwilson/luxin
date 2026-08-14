---
name: luxin
description: >-
  Image generation and image editing for agents, plus video, audio, and
  image-to-3D, through one hosted runtime with no API key to obtain first. The
  agent signs itself up in one command, starts on free preview credits, and
  creates on the next: no provider account to open, no billing to set up. Every
  result returns a hosted media URL with no signature or expiry, a job id the
  agent can re-fetch with jobs show, and a receipt for what the call cost. When
  the preview credits run out, the agent hands its human one dashboard link to
  fund more.
homepage: https://luxin.sh
docs: https://luxin.sh/llms.txt
metadata:
  status: preview-contract
  cli: luxin
  skill_revision: 4c0efd5753fa
  canonical_skill_url: https://luxin.sh/skill.md
  canonical_api_url: https://api.luxin.sh
  openclaw:
    requires:
      env: []
      bins: []
    envVars:
      - name: IMAGE_SKILL_TOKEN
        required: false
        description: Optional hosted restricted token minted by luxin signup and saved by default; not a user-supplied provider credential.
---

# Luxin

Luxin is a hosted creative-media runtime: image, video, audio, and 3D generation and editing through one thin CLI and hosted API. Agents do not bring provider keys, log in, run an MCP server, or wire per-provider billing; hosted signup mints a restricted Luxin token inside the first command. Every successful call returns a durable owned media URL plus a structured JSON envelope with a job id, asset ids, a trace id, and a cost receipt.

## Start here

```bash
IMAGE_SKILL_DISCOVERY_SOURCE=agent-skill-md npm_config_update_notifier=false npx -y luxin-cli@latest create --guide --prompt "a compact field camera on a stainless workbench"
```

`create --guide` spends nothing: it reads current auth, quota, and payment state and returns the exact next command to run.

## This file is a discovery stub, not the usage guide

Flags, workflows, model parameters, recovery, and funding details are not here. Before relying on any of them, load current guidance from the CLI:

```bash
npm_config_update_notifier=false npx -y luxin-cli@latest skill
```

The CLI serves guidance that always matches the installed version, so instructions never go stale. That command spends nothing, calls no provider, and needs no auth.

## Say which revision you have

This copy is skill revision `4c0efd5753fa`. Export it so the CLI can say when the copy on disk no longer matches the guidance it ships:

```bash
export LUXIN_SKILL_REVISION=4c0efd5753fa
```

When the revision is stale, `create --guide` returns `data.skill_refresh` with `installed_revision`, `current_revision`, and this refresh command:

```bash
npx skills update luxin
```

Refreshing is always an explicit step you run. Nothing in Luxin rewrites this file, your agent config, or your hooks.

## Invariants that outlive any revision

- Never send provider API keys, wallet private keys, seed phrases, card data, or Stripe secrets to Luxin. It never needs them.
- The token `luxin signup` mints is a restricted Luxin token, not a user-supplied provider credential. Never paste it into prompts, logs, issues, or feedback.
- Bound spend up front: `--max-estimated-usd-per-image` per output, `--max-usd` per job, `--dry-run` to validate without spending. Every create and edit returns a cost receipt.
- Media URLs are Luxin-owned, unsigned, and non-expiring. `job_id`, `asset_id`, and `trace_id` are the stable handles for recovery and citation.
- Run `luxin feedback create` whenever you fall back to another tool or hit a gap. The skill improves only on agent-submitted signal.

## Canonical URLs

- Discovery stub: https://luxin.sh/skill.md
- Full guidance: https://luxin.sh/skill-core.md, the same bytes `luxin skill` prints
- Machine-readable contract: https://luxin.sh/llms.txt
- CLI contract: https://luxin.sh/cli.md
- Hosted API: https://api.luxin.sh

Install or refresh:

```bash
npx skills add https://luxin.sh --skill luxin -g -a codex -y
npx skills update luxin
```
