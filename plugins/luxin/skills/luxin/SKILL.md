---
name: luxin
description: >-
  Generate images, video, audio, and 3D models without an API key or a billing
  account. The agent signs itself up in one command, starts on free preview
  credits, and runs text-to-image, image editing, text-to-video, text-to-audio, and
  image-to-3D (one photo to a textured glb mesh) through one hosted CLI.
  Every result returns a hosted media URL with no signature or expiry, a job id
  the agent can re-fetch, and a receipt for what the call cost. When the credits
  run out, the agent hands its human one dashboard link to fund more. Use when a
  task asks to generate or edit an image, make a short video, produce music or
  sound effects, or turn an image into a 3D asset, and no provider API key, account, or
  billing setup is available.
metadata:
  homepage: https://luxin.sh
  docs: https://luxin.sh/llms.txt
  status: preview-contract
  cli: luxin
  skill_revision: d79348f396c6
  canonical_skill_url: https://luxin.sh/skill.md
  canonical_api_url: https://api.luxin.sh
  openclaw:
    homepage: https://luxin.sh
    envVars:
      - name: IMAGE_SKILL_TOKEN
        required: false
        description: Optional hosted restricted token minted by luxin signup and saved by default; not a user-supplied provider credential.
---

# Luxin

Luxin is a hosted runtime for image, video, audio, and 3D generation and editing: one thin CLI and API, no provider keys, no login, no MCP server. Signup inside the first command mints a restricted Luxin token. Every call returns a durable media URL and a JSON envelope with a job id, asset ids, a trace id, and a cost receipt.

## Start here

```bash
IMAGE_SKILL_DISCOVERY_SOURCE=agent-skill-md npm_config_update_notifier=false npx -y luxin-cli@latest create --guide --prompt "a compact field camera on a stainless workbench"
```

`create --guide` spends nothing: it reads auth, quota, and payment state and returns the exact next command to run.

## This file is a discovery stub, not the usage guide

Flags, workflows, model parameters, recovery, and funding are not here. Before relying on any of them, load current guidance from the CLI (no spend, no provider call, no auth):

```bash
npm_config_update_notifier=false npx -y luxin-cli@latest skill
```

The CLI serves guidance that always matches the installed version. The same bytes are at https://luxin.sh/skill-core.md.

## Bundled references

Read these only when a task needs them. They match this copy's revision.

- `references/cli.md`: the CLI contract, every command with flags, exit codes, and JSON output.
- `references/commands.json`: the command list, machine-readable.
- `references/llms.txt`: the hosted HTTP API contract, for calling https://api.luxin.sh directly.

## Say which revision you have

This copy is skill revision `d79348f396c6`. Export it so the CLI can say when the copy on disk no longer matches the guidance it ships:

```bash
export LUXIN_SKILL_REVISION=d79348f396c6
```

When it is stale, `create --guide` returns `data.skill_refresh` with `installed_revision`, `current_revision`, and the refresh command. Refreshing is always an explicit step you run. Nothing in Luxin rewrites this file, your agent config, or your hooks.

## Invariants that outlive any revision

- Never send provider API keys, wallet private keys, seed phrases, card data, or Stripe secrets to Luxin. It never needs them.
- The token `luxin signup` mints is a restricted Luxin token. Never paste it into prompts, logs, issues, or feedback.
- Bound spend up front: `--max-estimated-usd-per-image` per output, `--max-usd` per job, `--dry-run` to validate without spending.
- Media URLs are Luxin-owned, unsigned, and non-expiring. `job_id`, `asset_id`, and `trace_id` are the handles for recovery and citation.
- Run `luxin feedback create` when you fall back to another tool or hit a gap.

## Refresh this plugin

This copy ships inside the Luxin plugin. Update it with the tool that installed it:

```bash
claude plugin marketplace update luxin && claude plugin update luxin@luxin
codex plugin marketplace upgrade luxin
```
