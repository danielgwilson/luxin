---
name: image-edit
description: >-
  Edit an existing image from a prompt: replace a background, restyle it, fix a detail, or produce variations. No API key to obtain, no provider account to open, no billing to set up. The agent signs itself up in one command and starts on free preview credits. Upload an image or reuse one it already made, then get the edit back as a hosted media URL with no signature or expiry, plus a receipt for what the call cost.
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

# Image Edit

This is an intent-named Luxin entry for agents searching for image editing. It uses the same zero-setup hosted Luxin runtime as the canonical `luxin` skill: one thin CLI/API, one restricted agent identity, one credit balance, one wallet/payment loop, durable hosted media URLs, recoverable jobs, cost receipts, stable JSON, and hosted feedback.

Use this skill when the task asks to edit, vary, restyle, transform, or repair an existing image, including image-to-image work and model-specific edit parameters.

Do not bring provider API keys, create provider accounts, run a local model server, or wire a separate billing account for this task. Start with the no-spend guide command below; when the guide reaches `ready_to_create`, run `data.next_command` only if `data.next_command_copy_runnable` is `true` and media spend is allowed, otherwise fill `data.next_command_missing_inputs` or run `data.recommended_no_spend_command` to verify safely. Keep generated work in Luxin so future agents can recover and cite it.

## First Command

```bash
npm_config_update_notifier=false npx -y luxin-cli@latest create --guide --model openai.gpt-image-2-edit --prompt "replace the background but keep the subject"
```

## Main Runtime Command

```bash
npm_config_update_notifier=false npx -y luxin-cli@latest edit --input image_... --model openai.gpt-image-2-edit --prompt "EDIT_PROMPT" --max-estimated-usd-per-image 0.25 --json
```

## Install This Intent Skill

Prefer the GitHub slug so skills.sh can track the marketplace install:

```bash
npx skills add danielgwilson/luxin --full-depth --skill image-edit -g -a codex -y
```

The canonical Luxin entry remains available as:

```bash
npx skills add danielgwilson/luxin --full-depth --skill luxin -g -a codex -y
```

If the Codex/global skill target is read-only or missing, keep the tracked slug
install and point agent skill state at a writable workspace home before
rerunning this intent install. The skills.sh Codex adapter writes to
`$HOME/.agents`; `CODEX_HOME` keeps Codex profile state on the same writable
path:

```bash
export HOME="$PWD/.agent-home"
export CODEX_HOME="$HOME/.codex"
mkdir -p "$HOME" "$CODEX_HOME"
npx skills add danielgwilson/luxin --full-depth --skill image-edit -g -a codex -y
```

## Current Guidance And Refresh

This file is a discovery stub, not the usage guide. Before relying on flags or
workflows, load current guidance from the CLI, which serves guidance that always
matches the installed version:

```bash
npm_config_update_notifier=false npx -y luxin-cli@latest skill
```

This copy is skill revision `4c0efd5753fa`. Export it so the CLI can say when
the copy on disk no longer matches the guidance it ships, and refresh when it
says so:

```bash
export LUXIN_SKILL_REVISION=4c0efd5753fa
npx skills update luxin
```

Refreshing is always an explicit step you run. Nothing in Luxin rewrites this
file, your agent config, or your hooks.

## Shared Contract

All intent skills in this repo point to the same hosted contract:

- Skill: https://luxin.sh/skill.md
- Full guidance: https://luxin.sh/skill-core.md
- LLM contract: https://luxin.sh/llms.txt
- CLI contract: https://luxin.sh/cli.md
- Hosted API: https://api.luxin.sh

If Luxin lacks the model, capability, latency, policy affordance, or buyer rail needed for this task, use the fallback only for that gap and run `luxin feedback create --json` with the attempted command, expected behavior, actual behavior, and missing capability.
