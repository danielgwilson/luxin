# Changelog

This changelog tracks the public `image-skill` CLI package and public skill
mirror. The npm package metadata remains the authority for tarball integrity and
provenance; this file is the human- and agent-readable release map.

## Unreleased

## 0.2.5 - 2026-08-09

- Release (correctness): `edit --guide` selects a model again. It gated on
  `media.input.images.required`, which the hosted `/v1/models` summary does not
  publish, so on 0.2.4 every edit brief returned `no_executable_model` and the
  blocker named `create`. The predicate now reads `supports`, which the summary
  does publish; measured on the live 220-model catalog the two express the same
  79-model set, so this drops a redundant conjunct rather than a guarantee. The
  blocker also names the operation it actually failed on.
- Release (correctness): a plain video brief reports its aspect ratio again.
  `selection.suggested_aspect_ratio` read the same unpublished block and
  returned null on every real video call unless the brief happened to name a
  ratio.
- Correction (added after 0.2.5 shipped): the 0.2.5 tarball carries a "known
  issue" note claiming `create --guide` can quote a different credit figure than
  the `--dry-run` it hands you. **That note is wrong and the behaviour it
  describes does not exist.** It was written from a measurement taken during a
  deploy-skew window, minutes after the fix merged and before the hosted API had
  deployed its half. Measured after both halves landed, the guide and the dry-run
  agree: 5 and 5 with no ratio stated, 3 and 3 at 16:9. #2259 is fixed and
  closed. Budgeting from the dry-run figure remains sound advice, but it is not a
  workaround for anything.

## 0.2.4 - 2026-08-09

- Release (correctness): the guide honors an aspect ratio stated in the brief
  instead of dropping it (#2213, #2203, #2209). A "16:9 cinematic widescreen
  poster" brief previously returned a 2048x2048 square and charged 12 credits
  for it: `selection.suggested_aspect_ratio` was hard-null for every image
  model because the guide only ever suggested a ratio for video. The guide now
  extracts an explicit ratio conservatively, treats it as a required capability
  during model selection the way #2225 treats seed, and passes
  `--aspect-ratio` through to create, dry-run and edit. Bare "portrait" and
  "landscape" deliberately do not fire, and neither do quantity ratios ("the
  ratio of sugar to flour is 3:2") or bare clock times.
- Release (output): `create --guide` at an unblocked `ready_to_create` returns
  the decision rather than every field (#2204 and its cluster). Measured
  21,667 to 7,911 bytes, 449 to 200 lines. A blocked agent still receives the
  full recovery and self-fund apparatus, because that is when it is the right
  answer, and the pre-wall funding nudge survives whenever it is genuinely
  recommended. `data.output_mode` names every omitted and compacted field and
  carries a copy-runnable `--explain`, so nothing is trimmed silently.
- Release (cost): `--intent` now drives model selection (#2231). `draft`
  previously selected a 25-credit model against a 12-credit default and now
  selects a 1-credit one; the unhinted default drops from 12 to 4 credits.
  `final` still selects the quality model, and reproducibility briefs still
  route to a seed-capable model. `cost.cheaper_alternative` names one available
  model that costs strictly less and still satisfies the brief.
- Release (trust): public responses no longer publish our provider cost,
  revenue, realized margin, target margin, or payment-fee model. What a caller
  is charged is unchanged; what we paid and made is no longer disclosed.
- Release (dry-run): hosted create and edit responses carry an explicit
  `data.mutation` stating `provider_call`, `credit_debit` and `media_write`
  rather than leaving them to be inferred (#2216), and planned assets are
  labelled as placeholders rather than media.
- Release (contract): `aspect_ratio` is documented in `skill.md` as the
  top-level normalized control it always was.
- Release (media): newly created assets are returned at `media.luxin.sh`.
  Existing `media.image-skill.com` URLs continue to resolve and are still
  accepted as input.
- Release (discovery): the `image-skill` skill slug resolves again. The rename
  removed it and `npx skills add ... --skill image-skill` had failed since
  2026-07-13 on the mirror path carrying most of our installs.

## 0.2.3 - 2026-08-04

- Release (self-fund/recovery): the wall now offers a human-funding handoff
  instead of only a rail no external agent could walk (#2201). Both wall types
  — credits depleted and daily job cap reached — route through
  `QUOTA_EXCEEDED`, and the recovery envelope now carries
  `error.recovery.human_handoff`: a copy-runnable `luxin claim code --json`,
  typed `no_spend`, with the honest instruction to hand `data.dashboard_url`
  (and nothing else — never the token, never the raw code) to your human, who
  funds credits at the dashboard in about a minute. With no wallet evidence —
  the external default — that handoff leads `error.recovery.suggested_command`
  and `error.recovery.suggested_commands`; the agent-native x402 quote/buy rail
  stays listed and `top_up.preferred_payment_method`
  (`stripe_x402.exact.usdc`) is unchanged. New `error.recovery.delegated_spend`
  (`state`, `per_tx_cap_usd`, `agent_day_remaining_usd`, `requires_wallet`)
  lets an agent tell whether it can settle x402 itself before it stops at the
  wall; it defaults to `state: "unknown"`, and when a caller proves delegated
  spend is available the x402 quote leads instead. The credits-depleted wall
  message — the majority wall — now names the price (a ~$5 top-up of 500
  credits, pack `starter-500`), the concrete next step, and both paths, at the
  quality the daily-cap message already had. The packaged CLI rewrites the
  handoff command through your invocation prefix, so what the wall prints is
  runnable as printed.
- Release (honest messaging): the `create --guide` / `edit --guide`
  `quota_required` blocker is now trigger-aware (#2200). It used to always emit
  the credits-shortfall line ("Selected first image requires N credits; current
  remaining credits are M") even when the trigger was the daily job cap, so an
  agent holding spare credits read a message that was simply wrong about why it
  was blocked. The blocker now mirrors the stage's credit-first ordering:
  credits only outrank the daily cap when they are genuinely short, and
  otherwise the message names the real trigger — "You've reached today's job
  allowance (X/day); a top-up raises your daily allowance so you can keep
  creating now" — matching the hosted daily-cap copy.
- Release (no-spend mode): `create --guide` and `edit --guide` accept an opt-in
  `--no-spend` output mode (#2194). A cold-agent no-spend study got a guide
  response that repeatedly embedded live create, quote, buy, and payment
  command templates, which buried the safe dry-run and raised the chance of
  picking a prohibited action. With `--no-spend`,
  `data.no_spend_output_mode.enabled` is `true` and the live funding templates
  are omitted — `data.self_fund_next_command`,
  `data.self_fund_next_command_label`, `data.self_fund_handoff`,
  `data.self_fund_preparation`, and `data.checks.payments.suggested_commands`,
  each named in `data.no_spend_output_mode.suppressed_fields`. The dry-run
  command (`data.recommended_no_spend_command` / `data.no_spend_next_command`)
  and the `provider_call` / `credit_debit` / `media_write` false proof in
  `data.mutation` are retained. The funding path stays discoverable without
  dominating via `data.no_spend_output_mode.self_fund_discovery`:
  `rerun_with_funding_command` re-runs the same guide without `--no-spend`, and
  `inspect_methods_command` is a read-only, no-spend payment-method
  inspection. `--no-spend` is a guide output mode: outside `--guide` it is
  rejected with the pointer to `create --dry-run` for a no-spend planned job.
  `luxin create --help` and the packaged `cli.md` / `commands.json` carry the
  flag.
- Release (trust/billing): a completed, charged job always surfaces an asset
  (#2107). A live create/edit reserves credit before calling the provider and
  settles on the provider's success envelope — but a provider that answered
  SUCCESS with an empty or planned-only asset list used to settle the
  reservation and commit a charged, asset-less job, so the agent was billed for
  nothing and had no recoverable job or asset. The runner now requires at least
  one real (non-planned) asset before settling: otherwise it releases the
  reserved credit and returns a retryable `PROVIDER_COMPLETED_WITHOUT_ASSET`
  failure instead of committing the charge. Nothing to change on your side —
  the debit-without-media outcome is gone.
- Release (guide reliability): the `create --guide` executable-default read is
  guarded against the shape the hosted registry actually returns (#2109).
  `GET /v1/models` serves the compact model-summary rows, which carry
  `model_execution_status` as a flat field rather than nested under
  `execution`; a nested-only read failed every row's executable check and
  dead-ended the guide at `no_executable_model` even though an executable
  default existed and an explicit `create --dry-run --model fal.bagel` still
  planned for zero credits. The flat-reading fix shipped earlier, but every
  guide fixture used the nested shape, so a regression would have passed CI.
  This release adds a faithful regression test serving the compact/flat shape
  and asserting `ready_to_create` with the executable default selected.
- Resolved (0.2.2 known limitation): the `dashboard.claim` grant backfill
  landed (#2184), so `luxin claim code` no longer answers `CAPABILITY_DENIED`
  for agents whose tokens predate the hosted dashboard plane. That matters more
  now that the wall itself recommends the command.
- Release (hosted parity): the Stripe reconciliation sweep is rail-aware and
  transitions confirmed-unsettled pending attempts older than its abandonment
  window to a terminal `expired` state with an audit trail (#2160). Settled
  attempts are never abandoned and live-money retrieval failures still fail
  loudly. No packaged CLI command changed for this; stale open quotes on your
  account simply stop lingering as pending forever.
- No payment caps, wallet settlement, provider spend, dist-tag mutation, or
  media generation behavior changed in this release bump beyond the
  debited-no-asset release path above, which only ever refunds.

## 0.2.2 - 2026-07-30

- Release (retention/self-fund): publish the human handoff from #2181. New verb
  `luxin claim code` mints a single-use, 15-minute dashboard link for the
  authenticated agent's human and hands back `data.dashboard_url` — give your
  human that link and they can watch your work and fund your credits there,
  signing in with nothing but the link (no email, no password, no provider
  billing setup). The mint envelope teaches the handoff in-band rather than only
  in docs: `data.human_handoff` carries
  `share_field: "data.dashboard_url"` and `never_share: ["token", "code"]`
  alongside a warning with the same sentence, so an agent that never reads
  `cli.md` still learns to send the link and nothing else. The code rides in the
  URL fragment (`#code=...`), which browsers never send to a server, so sharing
  the link intact keeps the credential out of server logs and analytics.
- Release (activation): create and edit successes that produced real durable
  media now carry `data.next_actions.share_with_human` — the same copy-runnable
  `luxin claim code --json`, typed no-spend like the existing `inspect_job` /
  `inspect_asset` / `iterate_edit` / `self_fund` actions — so the handoff is
  offered at the moment finished work exists to show. Dry runs never carry it:
  inviting a human to look at a plan is the wrong moment for the funding ask.
- Release (contract surfaces): `luxin claim` usage widens to
  `luxin claim <request|code> --json`, `claim code` joins root help with its own
  help entry, and the packaged contract picks up the matching sections —
  `cli.md` `#luxin-claim-code`, a "Show your human" section in `SKILL.md`, and
  step `7a. Human handoff` plus `luxin claim code --json` in `llms.txt`. No
  payment caps, wallet settlement, provider spend, hosted deploys, production
  writes, or media generation behavior changed in this release bump.
- Known limitation: `claim code` requires the `dashboard.claim` grant, which is
  persisted per token at signup. Tokens minted before the hosted dashboard
  plane shipped do not carry it and answer `CAPABILITY_DENIED` until an
  additive grant backfill runs; agents that sign up now carry the grant.

## 0.2.1 - 2026-07-28

- Release (activation/self-fund): publish the first `luxin-cli` payload since
  the `0.2.0` rename so external agents receive the credits-as-funded-boundary
  quota contract from #2149 — the starter preview is 50 lifetime credits with
  a 50-job UTC-day compatibility cap, funded identities have no daily job cap
  because prepaid credits and atomic credit reservations are the spend
  boundary, and `usage quota` omits `daily_jobs` for funded identities — plus
  the guide budget-basis fix from #2164 so `create --guide` picks hosted
  defaults against the same credit debit the hosted budget guard enforces (a
  `max_estimated_usd_per_image` cap in the $0.09-$0.12 band now plans the
  1k/9-credit xAI default instead of failing `BUDGET_EXCEEDED` at 2k).
- Release (discovery/attribution): the guide `auth_required` signup handoff
  now asks the agent to self-report a `DISCOVERY_SOURCE` placeholder when no
  slug is configured in the environment, and the packaged `SKILL.md`,
  `README`, and `cli.md` quickstarts carry `--discovery-source` /
  `IMAGE_SKILL_DISCOVERY_SOURCE` attribution from #2166 so external signups
  stop arriving unattributed.
- Release (hosted parity): the packaged contract picks up hosted behavior
  shipped since `0.2.0`: model-parameter validation fails closed on stray
  `series_amount` and only enforces schema-declared integer minimums (#2161),
  `models show` and `capabilities` serve the exact catalog schema the hosted
  validator enforces (#2167), and signup envelopes carry an honest quota
  warning pointing at the runnable self-fund path when the rolling daily
  starter free-preview grant budget is exhausted (#2163). No payment caps,
  wallet settlement, provider spend, hosted deploys, production writes, or
  media generation behavior changed in this release bump.

## 0.1.72 - 2026-07-03

- Release (activation/self-fund): publish the quota-wall recovery contract from
  #2064 so `error.recovery.suggested_command` points directly at the
  browserless x402 top-up quote while `error.recovery.top_up.first_command`
  remains the no-spend payment-method inspection path. No payment caps, wallet
  settlement, provider spend, hosted deploys, production writes, or media
  generation behavior changed in this release bump.

## 0.1.71 - 2026-07-03

- Release (agent UX/trust): publish the public contract guidance from #2057
  clarifying that idempotency keys, recovery commands, and in-flight
  reservation breadcrumbs are agent-internal details during normal progress
  updates. No payment caps, wallet action, provider spend, hosted deploy,
  production write, or media generation behavior changed in this release bump.

## 0.1.70 - 2026-06-25

- Release (activation/self-fund): publish the post-success self-fund handoff
  from #2042 so hosted create/edit successes can expose a top-level
  `data.self_fund_next_command` when quota says a top-up is recommended and
  the quote command is copy-runnable. This release prep does not change
  payment caps, wallet settlement, provider spend, hosted deploys, production
  writes, or media generation behavior.

## 0.1.69 - 2026-06-25

- Release (activation/discovery/self-fund): publish the post-`0.1.68` public
  CLI payload so external `image-skill@latest` agents receive copy-runnable
  self-fund commands on hosted quota walls, the public agent-skill discovery
  surface in CLI help/manifest output, and model discovery query/alias support
  for faster provider/model selection. This release prep does not change
  payment caps, wallet settlement, provider spend, hosted deploys, production
  writes, or media generation behavior.

## 0.1.68 - 2026-06-18

- Release (activation/self-fund): publish the quote-auth retry handoff from
  #2002 so a valid unauthenticated `credits quote` failure preserves the exact
  `error.recovery.after_auth` retry command, plus env-token and stdin-token
  handoffs, after signup. The quote remains no-charge: no buy, wallet
  settlement, provider call, credit debit, media write, hosted deploy, or
  production write changed in this release bump.

## 0.1.67 - 2026-06-18

- Activation/self-fund: when `create --guide` reaches `ready_to_create` and
  pre-wall self-fund setup is recommended, `data.self_fund_next_command` now
  aliases `data.self_fund_preparation.quote_command` with a `pre_wall_...`
  label so agents can open the x402 quote path before consuming remaining free
  allowance. Guide mode remains no-spend; buy/status/wallet settlement still
  require delegated spend authority.

## 0.1.66 - 2026-06-18

- Release (activation/self-fund): publish ready-to-create guide
  `data.self_fund_preparation` urgency fields, so agents that still have free
  allowance can see `setup_recommended`, `urgency_score`, and
  `urgency_reasons` before they spend down into the quota wall. The public CLI
  also derives the same urgency from older hosted quota responses that only
  carry `recommendation_reason`. No payment caps, wallet action, provider
  spend, hosted deploy, or production write changed in this release bump.

## 0.1.65 - 2026-06-17

- Release (activation/self-fund): make hosted create/edit success
  `data.quota.top_up` and `data.next_actions.self_fund` commands copy-runnable
  from the public CLI, so near-wall agents can move from a successful media
  response into the same zero-setup `npx image-skill@latest` top-up path as
  quota reads and quota errors. No payment caps, wallet action, provider spend,
  hosted deploy, or production write changed in this release bump.

## 0.1.64 - 2026-06-17

- Release (activation/self-fund): publish the hosted success-surface
  `data.next_actions.self_fund` visibility payload under an unpublished package
  version so `image-skill@latest` can expose the no-spend self-fund first
  command whenever hosted quota reports top-up availability. `recommended` and
  urgency remain priority signals; availability controls whether the action is
  visible. No payment caps, auth semantics, provider routing, wallet action,
  provider spend, media spend, hosted deploy, or production write changed in
  this release bump.

## 0.1.63 - 2026-06-17

- Release (activation/self-fund): make quota/payment error recovery top-up
  commands copy-runnable from ephemeral `npx image-skill@latest` runs. When
  hosted create/edit or payment commands return `error.recovery.top_up`, the
  public CLI now prefixes `suggested_command`, `suggested_commands`,
  `top_up.first_command`, `top_up.quote_command`, nested `top_up.commands.*`,
  and workflow step commands with the same zero-install handoff used by
  `usage quota --json` and `create --guide`.

## 0.1.62 - 2026-06-17

- Release (activation/self-fund): make `usage quota --json` top-up handoffs
  copy-runnable from ephemeral `npx image-skill@latest` runs. Quota
  `top_up`, generated `next_actions.self_fund`, and create-guide embedded
  quota top-up commands now carry the public handoff prefix instead of bare
  `image-skill ...` commands.

## 0.1.61 - 2026-06-17

- Release (activation/self-fund): add payment-attempt continuation actions.
  `credits status --quote-id ...` now repeats the exact
  `data.next_actions.recommended_buy` command for open x402/Checkout quotes,
  and Stripe x402 buy/status responses expose
  `data.next_actions.recommended_settlement` with exact payable-instruction
  paths, status/quota commands, and wallet-settlement safety flags.

## 0.1.60 - 2026-06-17

- Release (activation/self-fund): add `credits quote --json`
  `data.next_actions.recommended_buy`, carrying the returned `quote_id`, a
  stable purchase idempotency key, copy-runnable buy/status commands, and
  explicit live-money payment-attempt safety fields. Quote remains no-credit
  and no-media; buy still requires delegated spend and verified
  settlement/webhook fulfillment before credits are granted.

## 0.1.59 - 2026-06-17

- Release (activation/self-fund): add
  `credits methods --json` `data.next_actions.recommended_quote`, a ranked
  copy-runnable quote handoff that prefers browserless agent-settleable x402
  when available and falls back to Stripe Checkout when that is the only usable
  live rail. The quote step is explicitly no-spend: it creates a live-money
  payment object but does not move money, grant credits, debit credits, call a
  provider, or write media.

## 0.1.58 - 2026-06-17

- Release (activation/self-fund): mirror top-up urgency and the no-spend
  payment rail inspection command into hosted generated-asset
  `assets show/get` `data.next_actions.self_fund`, so agents that inspect or
  download created media can still discover the safe first self-fund step
  before ending the session. No payment caps, auth semantics, provider routing,
  wallet action, provider spend, media spend, hosted deploy, or production write
  changed in this release bump.

## 0.1.57 - 2026-06-16

- Release (activation/self-fund): mirror top-up urgency and the no-spend
  payment rail inspection command into hosted `activity list/show`
  `data.next_actions.self_fund`, so agents inspecting their ledger after
  generated work can discover the safe first self-fund step before hitting the
  quota wall. No payment caps, auth semantics, provider routing, wallet action,
  provider spend, media spend, hosted deploy, or production write changed in
  this release bump.

## 0.1.56 - 2026-06-16

- Release (activation/self-fund): mirror top-up urgency and the no-spend
  payment rail inspection command into successful hosted create/edit and
  `jobs show` `data.next_actions.self_fund`, so agents with free allowance can
  discover the safe first self-fund step before hitting the quota wall. No
  payment caps, auth semantics, provider routing, wallet action, provider
  spend, media spend, hosted deploy, or production write changed in this
  release bump.

## 0.1.55 - 2026-06-16

- Release (activation/self-fund): mirror top-up urgency and the first no-spend
  inspection command into `create --guide` quota-required
  `data.self_fund_handoff`, so agents that hit the quota wall can see blocked
  or near-wall priority and start with `credits methods` before quote/buy
  payment steps. No payment caps, auth semantics, provider routing, wallet
  action, provider spend, media spend, hosted deploy, or production write
  changed in this release bump.

## 0.1.54 - 2026-06-16

- Release (activation/self-fund): add explicit `urgency`,
  `urgency_score`, and `urgency_reasons` to quota top-up data and
  `data.next_actions.self_fund`, so activated agents can distinguish
  browserless top-up availability from near-wall or blocked top-up urgency
  without reverse-engineering recommendation reasons. No payment caps, auth
  semantics, provider routing, wallet action, provider spend, media spend,
  hosted deploy, or production write changed in this release bump.

## 0.1.53 - 2026-06-16

- Release (activation): align `create --guide` `auth_required` blocker copy
  with anonymous signup semantics. Fresh agents are told to sign up once, with
  `--agent-contact` optional and attachable later, instead of implying that a
  durable contact inbox is required before hosted media creation. No auth
  semantics, token storage, payment caps, provider routing, provider spend,
  media spend, hosted deploy, or production write changed in this release bump.

## 0.1.52 - 2026-06-16

- Release (activation/self-fund): publish the quota
  `data.next_actions.self_fund` handoff under an unpublished package version so
  `image-skill usage quota --json` gives activated agents a no-spend first
  action and the browserless x402 quote/buy/status path before or at the quota
  wall. No payment caps, provider routing, wallet action, provider spend, media
  spend, hosted deploy, or production write changed in this release bump.

## 0.1.51 - 2026-06-14

- Release (activation/self-fund): publish the post-0.1.50 public mirror payload
  under an unpublished package version so `image-skill@latest` can include the
  quota-wall `error.recovery.top_up.quote_command` handoff for browserless x402
  quote preparation. No payment caps, provider routing, wallet action, provider
  spend, media spend, hosted deploy, or production write changed in this release
  bump.

## 0.1.50 - 2026-06-14

- Release (activation/self-fund): publish the post-0.1.49 public mirror payload
  under an unpublished package version so `image-skill@latest` can include
  `create --guide` ready-stage `data.self_fund_preparation` for pre-wall
  browserless x402 quote preparation, plus the matching public contract docs.
  No payment caps, provider routing, wallet action, provider spend, or media
  spend changed in this release bump.

## 0.1.49 - 2026-06-13

- Release (activation/self-fund): publish the post-0.1.48 public mirror payload
  under an unpublished package version so `image-skill@latest` can include the
  top-up recovery quote commands made copy-runnable by #1894. No payment caps,
  provider routing, wallet action, provider spend, or media spend changed in
  this release bump.

## 0.1.48 - 2026-06-13

- Release (activation/self-fund): publish the post-0.1.47 public mirror payload
  under an unpublished package version so `image-skill@latest` can include the
  success `data.next_actions.self_fund.quote_command` handoff as a
  copy-runnable quote command. No payment caps, provider routing, wallet action,
  provider spend, or media spend changed in this release bump.

## 0.1.47 - 2026-06-13

- Release (activation): publish the post-0.1.46 public mirror payload under an
  unpublished package version so `image-skill@latest` can include guide
  `data.checks.quota.top_up` recommendations for browserless x402 top-up
  visibility. No hosted API behavior, payment caps, provider routing, wallet
  action, or media spend changed in this release bump.

## 0.1.46 - 2026-06-13

- Release (activation): publish the post-0.1.45 public mirror payload under an
  unpublished package version so `image-skill@latest` can include hosted
  create/edit `data.next_actions` for no-spend recovery, asset iteration, and
  promoted self-fund handoffs. No hosted API behavior, payment caps, provider
  routing, or public contract payload changed in this release bump.

## 0.1.45 - 2026-06-12

- Release (activation): publish the post-0.1.44 public mirror payload under an
  unpublished package version so `image-skill@latest` can include the
  full-depth GitHub-slug skill install guidance from #1859. No CLI behavior,
  hosted API behavior, payment caps, provider routing, or public contract
  payload changed in this release bump.

## 0.1.44 - 2026-06-12

- Release (freshness): republish the already-synced public CLI mirror content
  under an unpublished package version so `image-skill@latest` can match the
  public mirror commit again. No CLI behavior, hosted API behavior, payment
  caps, provider routing, or public contract payload changed in this release
  bump.

## 0.1.43 - 2026-06-12

- Feature (recovery): `doctor --json` now reports `data.in_flight` with
  outstanding live-spend breadcrumbs, idempotency keys, TTL state, sweep
  eligibility, and copy-runnable recovery commands.
- Feature (recovery): `doctor --sweep-in-flight --json` explicitly removes
  only sweep-eligible stale breadcrumbs after the long grace window; plain
  `doctor` remains inspect-only.
- Docs (recovery): the CLI contract now documents the stderr `in_flight` JSON
  diagnostic emitted by live create/edit before the blocking request, including
  the `2>&1` parsing caveat for combined-stream consumers.

## 0.1.42 - 2026-06-12

- Feature (distribution): the public repo/package now ships a root `SKILL.md`
  alongside the existing root `skill.md`. Uppercase is for convention-driven
  skill crawlers such as SkillsMP/ags/awesome-list; lowercase is retained for
  compatibility with existing hosted URLs, install docs, and older agents.

## 0.1.41 - 2026-06-12

- Fix (activation): `create --guide` now selects executable models from the
  compact default `/v1/models` response. The guide no longer reports
  `no_executable_model` while the same response says executable models exist;
  it preserves compact-row execution status, pricing, aspect-ratio fallback,
  and input-image hints so the first no-spend dry-run handoff is usable again.
- Fix (payments): Stripe Checkout handoff URLs now keep redirecting to the
  stored Stripe Checkout URL for non-expired fulfilled attempts instead of
  surfacing the misleading plain-text `handoff database read failed` page after
  webhook fulfillment.

## 0.1.40 - 2026-06-11

- Fix (growth): the `IMAGE_SKILL_DISCOVERY_SOURCE` attribution slug now
  survives the guide handoff — guide-emitted fresh-process replay commands
  (including the signup `next_command`) carry the env assignment in their
  shell prefix, the same fresh-process-env treatment as
  `IMAGE_SKILL_CONFIG_PATH`. Without this, a slug provided at
  `create --guide` was lost before signup, so channel attribution read zero
  by construction.

## 0.1.39 - 2026-06-10

- Feature (growth): **`signup --discovery-source SLUG`** (or the
  `IMAGE_SKILL_DISCOVERY_SOURCE` environment variable; the flag wins)
  optionally records the channel where the agent discovered Image Skill — a
  short slug such as `clawhub`, `skills-sh`, or `npm` (lowercase
  letters/digits plus `.`/`_`/`-`, max 64 chars). Self-reported and
  first-touch: the first signup that names a channel wins, and a later
  re-signup never relabels it. Never required — omit it rather than guessing.

## 0.1.38 - 2026-06-09

- Feature (auth): **signup is anonymous by default** — `signup --agent
--agent-name NAME --runtime RUNTIME` succeeds with no contact inbox.
  `--agent-contact` stays optional with unchanged semantics when provided
  (`--human-email` remains a compatibility alias). The guide's auth handoff no
  longer asks for an inbox placeholder. Anonymous signups mint a fresh agent
  identity on every call; reuse the saved config instead of re-running signup.
- Feature (auth): new **`claim request --contact INBOX --json`** attaches an
  email-shaped durable contact inbox to the authenticated agent after signup —
  the on-demand identity upgrade for billing, abuse, and recovery notices
  (`POST /v1/agent-claims`). Re-sending the same contact is idempotent
  (`data.state` is `unchanged`). Attaching a contact is not inbox-ownership
  verification: `data.claim_state` stays `unclaimed` and whoami/quota report
  `claim_request_state: "requested"`.
- Fix (recovery): the in-flight spend breadcrumb now survives **retryable**
  failures (network reset, proxy 5xx — the maybe-already-debited cases it
  exists for) and is removed only on success or a non-retryable rejection. A
  network-level failure on a live create/edit now echoes the request's
  `idempotency_key` in `error.recovery` so the advertised retry dedupes to one
  charge. The breadcrumb filename is sanitized so an unusual
  `--idempotency-key` value can never escape the `in-flight/` directory.

## 0.1.37 - 2026-06-09

- Fix (recovery): a live `create`/`edit` now leaves a recovery handle _before_
  the blocking request. Every live (non-dry-run) call carries an idempotency
  key even when you did not pass `--idempotency-key`, emits an `in_flight`
  notice with that key to stderr, and writes a durable breadcrumb at
  `<config-dir>/in-flight/<key>.json`. If the command is interrupted (for
  example you kill a create that hangs on a long provider wait after the credit
  was already reserved), re-run it with the surfaced key: the hosted API
  replays the original job (returning the asset you already paid for) or
  releases the reserved credit — never a double charge. The stdout JSON
  envelope is unchanged. Fixes the "create debited credits but no live job or
  asset surfaced" report (#1789).
- Fix (recovery): the proxy-killed non-JSON 5xx retry recovery now echoes the
  same idempotency key the charged request used, so the advertised retry
  genuinely dedupes instead of minting a non-matching key (#1228 follow-up).

## 0.1.36 - 2026-06-04

- Fix (guide): `create --guide --json` now marks templated follow-up commands
  explicitly with `data.next_command_copy_runnable`,
  `data.next_command_missing_inputs`, and
  `data.next_command_effect.requires_placeholder_substitution`. Auth signup,
  prompt recovery, payment handoff, and input-asset templates remain visible to
  agents, but placeholder values such as `AGENT_OR_OPERATOR_INBOX`,
  `AGENT_NAME`, `RUNTIME_NAME`, `QUOTE_ID`, and `PAYMENT_ATTEMPT_ID` are no
  longer presented as if the command can be copied blindly.

## 0.1.35 - 2026-06-04

- Fix (CLI aliases): natural modality-first commands now route into the
  guide-first public runtime. `image-skill image create`,
  `image-skill video create`, `image-skill audio create`,
  `image-skill 3d create`, and `image-skill image edit` normalize to the
  existing `create` / `edit` flows instead of failing with
  `PUBLIC_CLI_COMMAND_NOT_AVAILABLE`. Video, audio, and 3D aliases add the
  matching intent hint unless the agent already supplied `--intent`.

## 0.1.34 - 2026-06-04

- Fix (guide): `create --guide --model openai.gpt-image-2-edit` now returns an
  edit-shaped next command with an input placeholder and prompt instead of
  rejecting the requested edit model as non-create. The `image-edit` and
  `image-to-3d` intent skills now start from the guide-first zero-setup path,
  and their advertised live command caps match current model-priced credits.

## 0.1.33 - 2026-06-04

- Fix (guide): public `create --guide` replay commands now preserve explicit
  `--model`, `--provider`, `--intent`, and
  `--max-estimated-usd-per-image` context in `after_next`, auth rerun, and
  self-fund handoff commands. Modality-specific aliases can send an agent
  through signup or quota recovery without silently falling back to the default
  image guide.

## 0.1.32 - 2026-06-04

- Fix (payments): public `create --guide` payment suggestions and
  `credits methods` recovery commands now emit copy-runnable
  `npx -y image-skill@latest` commands that preserve
  `IMAGE_SKILL_CONFIG_PATH` when agents use a non-default config path. The
  self-fund quote/buy/status path no longer drops auth context after a fresh
  `npx` invocation.

## 0.1.31 - 2026-06-03

- Fix (guide): public `create --guide` copyable commands now preserve
  `IMAGE_SKILL_CONFIG_PATH` when an agent uses a non-default config path, and
  blocked-config recovery commands switch to the local writable fallback in the
  emitted `npx image-skill@latest` command. Auth signup, rerun, escape hatch,
  ready dry-run/create, and self-fund quote/buy/status commands all keep the
  same config context so fresh tool processes do not silently lose auth.

## 0.1.30 - 2026-06-03

- Fix (provenance): replace the stale version-stamped "Current Published
  Package" evidence with live npm metadata commands so agents verify the
  package they are actually running instead of trusting a doc that can age
  between releases.
- Fix (security): remove the hard-coded current attestation URL and keep the
  registry attestation check parameterized by package version.

## 0.1.29 - 2026-06-03

- Fix (self-fund): public `credits quote` now requires an explicit
  `--payment-method`, and structured `credits quote --help --json` marks that
  flag required instead of optional. Agents following the x402 quote/buy path
  now see the same contract the command enforces.
- Feature (discoverability): add the literal `image-generation` public skill
  alias alongside `ai-image-generation`, because skills.sh generic task search
  is strongly skill-name weighted for `image generation`. The alias points to
  the same zero-setup Image Skill runtime, identity, wallet, jobs, receipts,
  and feedback loop as the canonical `image-skill` skill.
- Fix (guide): public `create --guide` now follows the hosted quality-first
  image default instead of choosing the first executable create model in the
  catalog. Ready guides also foreground
  `data.recommended_no_spend_command` as the no-spend dry-run verification
  path while retaining `data.no_spend_next_command` as a compatibility alias.
- Fix (self-fund): quota-blocked guides now expose
  `data.self_fund_next_command` and `data.self_fund_handoff`, including
  auth-preserving wrappers for env/stdin tokens and the quote/buy/status
  commands for the preferred live-money rail.
- Fix (LLM contract): `llms.txt` now teaches quota recovery through
  `data.self_fund_next_command` and `data.self_fund_handoff` instead of the
  older generic payment-command list.
- Fix (LLM contract): the hosted signup API note now says raw `data.token` is
  returned only when `return_token` is true, while default public CLI signup
  saves config and intentionally reports `data.token: null`.
- Fix (guide payments): `create --guide` now returns
  `checks.payments.preferred_method_summary` so quota-blocked agents can read
  one explicit `top_up_path` instead of inferring whether the preferred rail is
  browserless agent self-fund or a human/browser payment handoff.
- Fix (activation): when `create --guide` reaches `auth_required` and the
  configured auth config path is blocked, `data.next_command` now prefixes the
  normal saved-config signup with
  `IMAGE_SKILL_CONFIG_PATH="$PWD/.image-skill/config.json"` instead of making
  the raw `--show-token --no-save` flow primary. The token-stdin/raw-token path
  remains in structured recovery for runtimes that intentionally avoid local
  config.

## 0.1.28 - 2026-06-02

- Feature (discoverability): publish intent-named public skill aliases
  (`ai-image-generation`, `image-edit`, `ai-video-generation`,
  `ai-audio-generation`, `image-to-3d`, and `creative-media`) from the public
  mirror and hosted `.well-known/agent-skills` index. Each alias points to the
  same zero-setup Image Skill runtime, CLI/API contract, identity, wallet, jobs,
  receipts, and feedback loop as the canonical `image-skill` skill, giving
  skills.sh task searches literal skill names to index without fragmenting the
  product.
- Fix (guide): `create --guide` now exposes `data.next_command_effect` and
  `data.no_spend_next_command`. When the guide reaches `ready_to_create`, the
  live create remains `data.next_command`, but it is explicitly labeled
  `live_media_create_credit_debit` with provider-call, hosted-create,
  credit-debit, and media-write flags. No-spend/evaluation agents can run the
  top-level dry-run verification command instead of digging through escape
  hatches or risking an accidental media job.
- Docs: public CLI, LLM contract, canonical skill, and modality aliases now
  teach the ready-to-create distinction between live media creation and
  no-spend verification.

## 0.1.27 - 2026-06-02

- Fix (activation): default hosted signup now reports saved auth as a positive
  `data.auth_handoff.status: "saved_config_ready"` state, keeps `data.token`
  null, and suppresses the generic hosted token-returned warning when the
  public CLI saved the token instead of showing it. Fresh agents can rerun the
  guide or continue with `whoami`, feedback, credits, create, or edit without
  hunting for a raw token or running a separate `auth save`.

## 0.1.26 - 2026-06-02

- Fix (activation): public CLI subcommand help flags now return command help
  instead of `INVALID_ARGUMENTS`. Fresh agents can run `signup --help`,
  `credits buy --help`, `models show --help`, or similar discovery commands
  without triggering auth, network, payment, or config validation.

## 0.1.25 - 2026-06-02

- Fix (activation): `create --guide` now probes whether the public CLI auth
  config path can actually be written before telling a fresh agent to run a
  config-saving signup. If the default path is blocked, the guide returns the
  browserless `signup --show-token --no-save --json` fallback plus
  `--token-stdin` rerun/create templates, so read-only or workspace-scoped
  runtimes can continue without losing the one-time hosted token.
- Fix (recovery copy): hosted signup config-write recovery now points agents at
  a fresh `signup --agent ... --show-token` command instead of the local-only
  `auth save` command, keeping the suggested recovery path valid for the hosted
  public CLI.

## 0.1.24 - 2026-06-02

- Fix (activation): hosted `signup --agent` now saves the restricted token to
  the public CLI config by default with `0600` permissions, while keeping the
  raw token hidden unless `--show-token` is explicitly requested. Fresh agents
  can run the guide's signup command, then continue with `whoami`, feedback,
  credits, create, or edit from saved config instead of juggling a one-time
  token through shell scope. `--show-token --no-save` remains available for
  runtimes with their own secret store.
- Feature (x402 self-fund): `credits buy --provider stripe_x402` now returns
  `stripe_x402.payable_instructions` when Stripe provides a Base crypto deposit
  address. Wallet-equipped agents get the exact USDC amount, atomic units,
  Base deposit address, optional token contract, expiry, and exact-amount flag
  needed to settle without a browser; Stripe PaymentIntent ids and client
  secrets remain redacted.
- Fix (payment readiness): `credits methods --json`, `create --guide`, public
  skill docs, and the scoreboard now distinguish `agent_initiated` from
  `agent_settleable`. A redacted browserless x402 deposit attempt is no longer
  treated as autonomous self-fund ready unless the hosted catalog explicitly
  reports `agent_settleable:true`; until then the guide prefers the Stripe
  Checkout path that can actually be completed.

## 0.1.23 - 2026-06-02

- Fix (guide payments): `create --guide` now distinguishes browserless,
  agent-payable, and human-handoff payment rails instead of collapsing the
  payment summary into a single browser-required flag. When the hosted catalog
  exposes `stripe_x402.exact.usdc` as available and browserless, the guide marks
  it as the preferred method and puts the x402 quote/buy/status commands before
  the Stripe Checkout fallback.
- Fix (quota recovery): when an authenticated agent has no remaining credits,
  guide mode now points `data.next_command` at the preferred credit quote command
  instead of the generic `credits methods` inspection command.

## 0.1.22 - 2026-06-02

- Fix (guide): `create --guide` now reports `cost.estimated_usd_per_image` as
  the actual Image Skill credit debit dollars, matching `estimated_credits`.
  The guide still exposes the upstream provider estimate separately as
  `estimated_provider_usd_per_image`, so agents no longer see a confusing
  "17 credits but $0.10" first-run cost mismatch.
- Fix (payment discovery): `credits methods --json` and
  `credits packs list --json` now tolerate `--token` / `--token-stdin`.
  Fresh agents that safely carry their signup token through stdin can inspect
  payment rails without hitting an unsupported-flag dead end; the token is
  drained and not forwarded to the no-auth discovery endpoint.

## 0.1.21 - 2026-06-02

- Release: ships the guide auth handoff already present on main to
  `image-skill@latest`. Fresh agents that run `create --guide` now receive
  `data.auth_handoff` templates in `auth_required` and `ready_to_create`, so a
  one-time hosted signup token can be carried through `IMAGE_SKILL_TOKEN` or
  `--token-stdin` without leaking it or falling back to URL installs.
- Test: keeps the public trust-packet fixture aligned with the new npm version
  so the release guard verifies the package, provenance, and CLI version as one
  contract.

## 0.1.20 - 2026-06-02

- Fix (funnel): the advertised `signup` usage line omitted the now-required
  `--agent-name` and `--runtime` flags, so a cold agent's first signup always
  stumbled before self-correcting via the recovery envelope. The top-level help
  now advertises the full required flag set, so a first signup with the
  advertised flags succeeds.
- Fix (funnel): the live create/edit receipt reported `cost.estimated_usd: null`
  while the dry-run/plan receipt populated it. The live receipt now derives
  `estimated_usd` from the same reservation credit-pricing the plan used, so plan
  and execution agree (a provider-reported concrete value still wins when
  present).
- Test: added a fault-injection test that forces the hosted provider to 5xx and
  asserts the error envelope carries `recovery.idempotency_key` +
  `suggested_command`, then proves a same-key retry replays and charges once.

## 0.1.19 - 2026-06-02

- Fix: the two newly-shipped modalities were broken on live prod despite green
  unit tests. Audio (`fal.stable-audio-25-text-to-audio`) failed server-side
  with `PROVIDER_FAILURE` "fal audio queue status returned HTTP 405" — the Fal
  queue status/result poll appended `requests/<id>` to the full sub-pathed model
  id, but Fal keys those endpoints by the app id only (`fal-ai/stable-audio-25`,
  sub-path dropped), so the poll 405'd. The queue runner now prefers the absolute
  `status_url`/`response_url` Fal returns and falls back to the app-level base.
  Video and Trellis (no sub-path) are unaffected.
- Fix: the documented promptless image-to-3D edit `image-skill edit --input
image_... --model fal.trellis-image-to-3d --json` (no `--prompt`) was
  unreachable — the edit validator required `--prompt` while the provider
  rejected any prompt. The public CLI bin (and the server) now treat Trellis as
  promptless: no `--prompt` is required and none is sent.
- Fix: a failed edit's `PROVIDER_FAILURE` recovery `suggested_command` now
  preserves `--input` and `--model` so the advertised retry is runnable verbatim
  (it previously collapsed to a bare `image-skill edit --idempotency-key ...`
  that failed "edit requires --input").

## 0.1.18 - 2026-06-02

- Contract: advertise the now-shipped audio and 3D modalities so registries
  (skills.sh, npm, the `.well-known` manifest) surface Image Skill for
  audio/music/sound and 3D/mesh/glb searches. This is a factual capability
  update — both modalities are live in production via the modality-generic path.
  Audio (music, sound) generation runs through `create` with
  `fal.stable-audio-25-text-to-audio` (Stable Audio 2.5), text-to-audio at a flat
  $0.20/clip, returning a durable owned `audio/wav` URL. 3D asset creation runs
  through `edit` as a promptless image-to-3D variation transform with
  `fal.trellis-image-to-3d` (Trellis), at a flat $0.02/asset, returning a durable
  owned `.glb` (`model/gltf-binary`) mesh URL. The skill/llms.txt frontmatter
  `description` and the npm package keywords now include audio and 3D. No CLI
  behavior change beyond the version bump; both modalities are model-id-gated
  through the existing create/edit surface.

## 0.1.17 - 2026-06-01

- Money integrity: `create` and `edit` now send `--idempotency-key` to the
  server so a retry of a transiently-failed generation REPLAYS the original
  job instead of charging again. `create --guide` bakes a generated key into
  its suggested command, and a proxy-killed 502 (`HOSTED_API_NON_JSON_RESPONSE`)
  now returns a recovery block with the request's idempotency key so the
  advertised retry is charge-safe. (0.1.16 parsed the flag but did not send it
  on create, so same-key retries still double-charged against the live server's
  dedup; this build closes that end-to-end.)

## 0.1.16 - 2026-06-01

- `credits buy` now accepts `--provider stripe_x402` to execute the agent-native
  USDC credit deposit end-to-end, and `credits quote` accepts
  `--payment-method stripe_x402.exact.usdc`. Previously the agent-native deposit
  method was advertised by `credits methods` but the CLI could only run the
  hosted-checkout provider, so an agent could discover the method without being
  able to act on it. The deposit command returns the redacted payment challenge
  and the `pay_stripe_crypto_deposit` next action; credits are granted only
  after verified settlement (poll `credits status`). No change to the
  `--provider stripe` hosted-checkout flow.

## 0.1.15 - 2026-05-31

- Republish from current `main` so the package matches the shipped contract:
  registry-slug-first install guidance (`npx skills add danielgwilson/image-skill-cli`),
  an MIT license, and the current zero-setup positioning (the prior
  enterprise-umbrella framing is fully retired in this build).
- Safety fix: this build rejects `edit --dry-run` with
  `PUBLIC_CLI_FLAG_NOT_AVAILABLE` instead of silently running a real, billed edit
  (the 0.1.14 behavior charged credits and consumed a daily job slot for a flag
  the agent expected to be a free cost preview). First-class edit dry-run support
  is tracked separately.

## 0.1.14 - 2026-05-29

- Refresh the public package with the guide-first `create --guide` flow so a
  fresh agent can get an `image-skill.create-guide.v1` no-mutation planning
  response before signup/auth setup.
- Keep the first creative command aligned with the public README, skill, and
  `llms.txt` contract.

## 0.1.13 - 2026-05-26

- Remove public changelog breadcrumbs for private harness payment rails.
- Keep the npm tarball aligned with the action-only public payment contract.

## 0.1.12 - 2026-05-26

- Publish the action-only payment-method public contract: public discovery now
  shows usable payment rails only.
- Remove staged/watch-only payment rail examples from the public npm docs and
  bundled skill references so agents are not steered toward unavailable flows.

## 0.1.11 - 2026-05-26

- Remove private non-production payment rails from the public CLI and public
  skill/docs contract.
- Make public credit quotes default to Stripe Checkout and reject unavailable
  payment methods locally before calling the hosted API.
- Keep private harness-only payment commands out of the public CLI package.

## 0.1.10 - 2026-05-22

- Stripe Checkout payment-link hardening follow-up.
- Make `checkout_compact_url` copy-safe by preferring the short Image Skill
  `checkout_handoff_url` whenever the hosted API provides one.
- Keep raw Stripe `checkout_url` only as the full fallback and preserve its
  required `#...` browser fragment.
- Add proof coverage that the Image Skill handoff redirects to the exact Stripe
  Checkout URL with the fragment intact.

## 0.1.9 - 2026-05-22

- Emergency Stripe Checkout payment-link hotfix.
- Restored full Stripe Checkout URL preservation, including the `#...`
  fragment required by Stripe's browser checkout app.
- Kept `checkout_handoff_url` as the preferred short human payment link, but
  made stale-server fallback safe by no longer fragment-stripping
  `checkout_url`, `checkout_compact_url`, or `next.fallback_checkout_url`.
- Do not use `image-skill@0.1.8` for live Stripe payments.

## 0.1.8 - 2026-05-22

- Hardened Stripe Checkout handoff responses for mobile terminals and chat.
- Added fragment-stripped `checkout_url` normalization so stale hosted API
  responses no longer cause the public CLI to print a long `#...` Stripe URL
  under the easiest field for agents to copy.
- Kept `checkout_handoff_url` as the preferred human payment link and
  `checkout_compact_url` as the explicit stale-server fallback.

## 0.1.7 - 2026-05-16

- Published public package `image-skill@0.1.7`.
- Added the hosted payment-backed credit flow and Stripe Checkout command
  surface.
- Added public model discovery and capability-preserving model parameter
  guidance.
- Added public skill installation guidance for `danielgwilson/image-skill-cli`.
- Added agent-facing selection guidance for when to use Image Skill instead of
  built-in image tools or direct provider APIs.

Release mapping:

- npm package: `image-skill@0.1.7`
- public repo commit from npm `gitHead`:
  `8676d325917a557e929717d6243446a134167e54`
- npm tarball integrity:
  `sha512-83WpSiW9wNu0gTDX0BHMT19rGEkI8j9s7pekFwWUPTa7p/MKhfV1dZcE9vvEeVhR1WpKU1gntHFeS27yu0MMEw==`
- npm attestation URL:
  `https://registry.npmjs.org/-/npm/v1/attestations/image-skill@0.1.7`

## Verification

For any version, agents should verify the package with:

```bash
npm view image-skill@VERSION version gitHead dist.integrity dist.tarball dist.attestations.url repository.url --json
```

Then inspect the public repo commit:

```bash
git ls-remote https://github.com/danielgwilson/image-skill-cli.git
```

Use the npm `gitHead` value to identify the package source commit. The public
repo `main` branch can be newer than the latest published package because docs
and skill contracts may sync between package releases.
