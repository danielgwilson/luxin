#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import os from "node:os";

const VERSION = "0.1.71";
const PACKAGE_NAME = "image-skill";
const DEFAULT_API_BASE_URL = "https://api.image-skill.com";
const DEFAULT_DOCS_BASE_URL = "https://image-skill.com";
const DEFAULT_NPM_REGISTRY_BASE_URL = "https://registry.npmjs.org";
const PUBLIC_REPO_URL = "https://github.com/danielgwilson/image-skill-cli";
const IN_FLIGHT_RESERVATION_TTL_MS = 15 * 60 * 1000;
const IN_FLIGHT_SWEEP_AFTER_MS = 24 * 60 * 60 * 1000;
const PROMPTLESS_EDIT_MODEL_IDS = new Set([
  "fal.flux-dev-redux",
  "fal.flux-krea-redux",
  "fal.flux-schnell-redux",
  // Promptless image-to-3D variation: the documented `image-skill edit --input
  // image_... --model fal.trellis-image-to-3d` (no --prompt) must succeed; the
  // provider rejects any prompt, so the public CLI must not require/send one.
  "fal.trellis-image-to-3d",
]);
const DEFAULT_CONFIG_PATH = join(
  process.env.XDG_CONFIG_HOME ?? join(os.homedir(), ".config"),
  "image-skill",
  "config.json",
);
const LOCAL_WRITABLE_CONFIG_PATH = "$PWD/.image-skill/config.json";
const SIGNUP_SUGGESTED_COMMAND =
  "image-skill signup --agent --agent-name NAME --runtime RUNTIME --json";
const SIGNUP_CONTACT_GUIDANCE =
  "Signup is anonymous by default: no contact inbox is required to get a restricted token. --agent-contact stays optional for attaching an email-shaped durable contact inbox at signup; otherwise attach one later with `image-skill claim request --contact INBOX --json` when funding or durability makes it worth having. Never invent an inbox or borrow an unrelated human email just to fill the flag. --human-email remains a compatibility alias.";
const CLAIM_REQUEST_SUGGESTED_COMMAND =
  "image-skill claim request --contact AGENT_OR_OPERATOR_INBOX --json";
const HOSTED_SIGNUP_TOKEN_RETURNED_WARNING =
  "hosted restricted token is returned once; store it in the agent runtime secret store and never paste it into prompts, logs, issues, or product feedback";
const PUBLIC_NPX_COMMAND_PREFIX =
  "npm_config_update_notifier=false npx -y image-skill@latest";
const AGENT_SKILL_URL = "https://image-skill.com/skill.md";
const AGENT_LLMS_URL = "https://image-skill.com/llms.txt";
const AGENT_CLI_DOCS_URL = "https://image-skill.com/cli.md";
const CREDIT_UNIT_USD = 0.01;
const TARGET_GROSS_MARGIN = 0.4;
const PAYMENT_BACKED_CREDIT_PAYMENT_FEE_RATE = 0.015;
const PAYMENT_BACKED_CREDIT_PAYMENT_FEE_MODEL = "stripe_stablecoin_usd_percent";
const MODALITY_COMMAND_ALIASES = new Map([
  ["image", { command: "create", intent: null }],
  ["video", { command: "create", intent: "video" }],
  ["audio", { command: "create", intent: "audio" }],
  ["3d", { command: "create", intent: "image-to-3d" }],
  ["image-to-3d", { command: "create", intent: "image-to-3d" }],
  ["three-d", { command: "create", intent: "image-to-3d" }],
]);
const PAYMENT_CREDENTIAL_FLAGS = new Set([
  "payment-token",
  "payment-secret",
  "payment-required",
  "payment-signature",
  "payment-response",
  "authorization",
  "bearer-token",
  "wallet-private-key",
  "private-key",
  "mnemonic",
  "seed-phrase",
  "card",
  "card-number",
  "card-token",
  "stripe-secret-key",
  "stripe-webhook-secret",
  "provider-key",
  "provider-receipt",
]);
const GUIDE_NEXT_COMMAND_PLACEHOLDERS = [
  {
    placeholder: "AGENT_OR_OPERATOR_INBOX",
    flag: "--agent-contact",
    value_description:
      "Optional email-shaped durable contact inbox; signup is anonymous by default and `claim request --contact` attaches one later. Use an agent-owned inbox when available, otherwise an operator, team, or sponsor inbox.",
    effect_description: "email-shaped durable contact inbox",
    example: "agent-inbox@example.com",
  },
  {
    placeholder: "AGENT_NAME",
    flag: "--agent-name",
    value_description:
      "Stable display name for this restricted agent identity.",
    effect_description: "stable agent identity name",
    example: "codex-image-worker",
  },
  {
    placeholder: "RUNTIME_NAME",
    flag: "--runtime",
    value_description:
      "Stable name for the agent runtime or substrate using Image Skill.",
    effect_description: "agent/runtime substrate name",
    example: "codex-cli",
  },
  {
    placeholder: "PROMPT",
    flag: "--prompt",
    value_description: "The real creative prompt to plan or create.",
    effect_description: "real creative prompt",
    example: "a compact field camera on a stainless workbench",
  },
  {
    placeholder: "KEY",
    flag: "--idempotency-key",
    value_description:
      "Unique idempotency key for this payment or create attempt.",
    effect_description: "unique idempotency key",
    example: "agent-generated-idempotency-key",
  },
  {
    placeholder: "QUOTE_ID",
    flag: "--quote-id",
    value_description: "Quote id returned by the preceding credits quote call.",
    effect_description: "quote id from credits quote",
    example: null,
  },
  {
    placeholder: "PAYMENT_ATTEMPT_ID",
    flag: "--payment-attempt-id",
    value_description:
      "Payment attempt id returned by the preceding credits buy call.",
    effect_description: "payment attempt id from credits buy",
    example: null,
  },
  {
    placeholder: "image_...",
    flag: "--input",
    value_description:
      "Image Skill input asset id, usually from upload, assets, jobs, or a previous create.",
    effect_description: "Image Skill input asset id",
    example: null,
  },
];

function agentSkillHint(commandPrefix = "image-skill") {
  return {
    url: AGENT_SKILL_URL,
    llms_url: AGENT_LLMS_URL,
    cli_docs_url: AGENT_CLI_DOCS_URL,
    read_command: "curl -fsSL https://image-skill.com/skill.md",
    recommended_start_command: renderGuidePrefixedCommand(
      commandPrefix,
      "create --guide --prompt PROMPT --json",
    ),
    model_discovery_command: renderGuidePrefixedCommand(
      commandPrefix,
      "models list --available --operation image.generate --json",
    ),
    model_inspection_command: renderGuidePrefixedCommand(
      commandPrefix,
      "models show MODEL_ID --json",
    ),
    no_spend: true,
    purpose:
      "Read the agent skill before paid media work; it explains model discovery, guide flow, model parameters, quota, and self-fund recovery.",
  };
}

const argv = normalizePublicArgv(process.argv.slice(2));
const result = await main(argv);
process.stdout.write(`${JSON.stringify(result.envelope, null, 2)}\n`);
process.exitCode = result.exitCode;

async function main(rawArgv) {
  const [command, ...rest] = rawArgv;

  if (command === undefined || command === "--help" || command === "-h") {
    return publicCliHelp([]);
  }

  if (command === "help") {
    return publicCliHelp(helpTarget(normalizePublicArgv(rest)));
  }

  if (hasHelpFlag(rest)) {
    return publicCliHelp(helpTarget([command, ...rest]));
  }

  if (command === "version" || command === "--version" || command === "-v") {
    return success("image-skill version", {
      version: VERSION,
      package: "image-skill",
      mode: "public_hosted_cli",
    });
  }

  try {
    switch (command) {
      case "doctor":
        return await doctor(rest);
      case "trust":
        return await trust(rest);
      case "signup":
        return await signup(rest);
      case "claim":
        return await claim(rest);
      case "auth":
        return await auth(rest);
      case "whoami":
        return await whoami(rest);
      case "usage":
        return await usage(rest);
      case "quota":
        return await quota(rest);
      case "credits":
        return await credits(rest);
      case "models":
        return await models(rest);
      case "capabilities":
        return await capabilities(rest);
      case "create":
        return await create(rest);
      case "upload":
        return await upload(rest);
      case "edit":
        return await edit(rest);
      case "assets":
        return await assets(rest);
      case "jobs":
        return await jobs(rest);
      case "activity":
        return await activity(rest);
      case "feedback":
        return await feedback(rest);
      default:
        return failure(
          `image-skill ${command}`,
          2,
          "PUBLIC_CLI_COMMAND_NOT_AVAILABLE",
          `public CLI command is not available: ${command}`,
          false,
          {
            suggested_command: "image-skill help --json",
            docs_url: "https://image-skill.com/cli.md",
          },
        );
    }
  } catch (error) {
    return failure(
      commandLabel(rawArgv),
      1,
      "PUBLIC_CLI_FAILED",
      error instanceof Error ? error.message : "unknown public CLI failure",
      true,
    );
  }
}

function publicCliHelp(path) {
  const key = helpKey(path);
  const help =
    commandHelpByKey(key) ?? commandHelpByKey(helpKey(path.slice(0, 1)));
  if (help === undefined) {
    return publicCliHelp([]);
  }
  return success(help.command, help);
}

function hasHelpFlag(argv) {
  return argv.includes("--help") || argv.includes("-h");
}

function normalizePublicArgv(argv) {
  const [maybeModality, maybeSubcommand, ...rest] = argv;
  if (maybeModality === undefined || maybeSubcommand === undefined) {
    return argv;
  }

  const alias = MODALITY_COMMAND_ALIASES.get(maybeModality);
  if (alias === undefined) {
    return argv;
  }

  if (maybeSubcommand === "create") {
    if (
      alias.intent !== null &&
      !rest.some((arg) => arg === "--intent" || arg.startsWith("--intent="))
    ) {
      return [alias.command, "--intent", alias.intent, ...rest];
    }
    return [alias.command, ...rest];
  }

  if (maybeModality === "image" && maybeSubcommand === "edit") {
    return ["edit", ...rest];
  }

  return argv;
}

function helpTarget(argv) {
  return parseArgs(argv.filter((arg) => arg !== "--help" && arg !== "-h"))
    .positionals;
}

function helpKey(path) {
  const clean = path.filter((arg) => !arg.startsWith("-"));
  if (clean.length >= 2) {
    return `${clean[0]} ${clean[1]}`;
  }
  return clean[0] ?? "";
}

function commandHelpByKey(key) {
  return {
    "": {
      command: "help",
      usage:
        "image-skill <doctor|trust|signup|claim|whoami|usage|quota|credits|capabilities|models|create|upload|edit|assets|jobs|activity|feedback> --json",
      docs_url: "https://image-skill.com/cli.md",
      agent_skill: agentSkillHint(),
      commands: [
        "doctor",
        "trust",
        "signup --agent --agent-name NAME --runtime RUNTIME",
        "claim request --contact INBOX",
        "whoami",
        "usage quota",
        "quota",
        "credits methods",
        "credits quote",
        "credits packs list",
        "credits buy",
        "credits status",
        "capabilities",
        "capabilities list",
        "capabilities show",
        "models",
        "models list",
        "models show",
        "create --guide",
        "image create --guide",
        "video create --guide",
        "audio create --guide",
        "3d create --guide",
        "create --dry-run",
        "create",
        "image edit",
        "upload",
        "edit",
        "assets show",
        "assets get",
        "jobs show",
        "jobs wait",
        "activity list",
        "activity show",
        "feedback create",
      ],
    },
    doctor: {
      command: "image-skill doctor help",
      usage: "image-skill doctor --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-doctor",
      description:
        "Check hosted API reachability, CLI version, auth state, health, and live-spend recovery breadcrumbs.",
      optional_flags: ["--sweep-in-flight"],
    },
    trust: {
      command: "image-skill trust help",
      usage: "image-skill trust --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-trust",
      description:
        "Return npm provenance, hosted contract hashes, API health, and model availability evidence.",
    },
    signup: {
      command: "image-skill signup help",
      usage:
        "image-skill signup --agent --agent-name NAME --runtime RUNTIME --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-signup-agent",
      required_flags: ["--agent", "--agent-name", "--runtime"],
      optional_flags: [
        "--agent-contact",
        "--show-token",
        "--no-save",
        "--token-stdin",
      ],
    },
    claim: {
      command: "image-skill claim help",
      usage:
        "image-skill claim request --contact AGENT_OR_OPERATOR_INBOX --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-claim-request",
      subcommands: ["request"],
    },
    "claim request": {
      command: "image-skill claim request help",
      usage:
        "image-skill claim request --contact AGENT_OR_OPERATOR_INBOX --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-claim-request",
      required_flags: ["--contact"],
      optional_flags: ["--token-stdin"],
    },
    auth: {
      command: "image-skill auth help",
      usage: "image-skill auth <status|save|logout> --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-auth",
      subcommands: ["status", "save", "logout"],
    },
    "auth status": {
      command: "image-skill auth status help",
      usage: "image-skill auth status --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-auth",
    },
    "auth save": {
      command: "image-skill auth save help",
      usage: "image-skill auth save --token-stdin --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-auth",
    },
    "auth logout": {
      command: "image-skill auth logout help",
      usage: "image-skill auth logout --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-auth",
    },
    whoami: {
      command: "image-skill whoami help",
      usage: "image-skill whoami --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-whoami",
    },
    usage: {
      command: "image-skill usage help",
      usage: "image-skill usage quota --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-usage",
      subcommands: ["quota"],
    },
    "usage quota": {
      command: "image-skill usage quota help",
      usage: "image-skill usage quota --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-usage",
    },
    quota: {
      command: "image-skill quota help",
      usage: "image-skill quota --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-quota",
    },
    credits: {
      command: "image-skill credits help",
      usage: "image-skill credits <methods|packs list|quote|buy|status> --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-credits",
      subcommands: ["methods", "packs list", "quote", "buy", "status"],
    },
    "credits methods": {
      command: "image-skill credits methods help",
      usage: "image-skill credits methods",
      docs_url: "https://image-skill.com/cli.md#image-skill-credits",
    },
    "credits packs": {
      command: "image-skill credits packs help",
      usage: "image-skill credits packs list --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-credits",
      subcommands: ["list"],
    },
    "credits quote": {
      command: "image-skill credits quote help",
      usage:
        "image-skill credits quote --pack PACK_ID --payment-method stripe_x402.exact.usdc --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-credits",
      required_flags: ["--pack or --credits", "--payment-method"],
      optional_flags: ["--idempotency-key"],
    },
    "credits buy": {
      command: "image-skill credits buy help",
      usage:
        "image-skill credits buy --provider stripe_x402 --quote-id QUOTE_ID --idempotency-key KEY --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-credits",
      required_flags: ["--provider", "--quote-id", "--idempotency-key"],
      supported_providers: ["stripe", "stripe_x402"],
    },
    "credits status": {
      command: "image-skill credits status help",
      usage:
        "image-skill credits status --payment-attempt-id PAYMENT_ATTEMPT_ID --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-credits",
      required_flags: ["--payment-attempt-id"],
    },
    models: {
      command: "image-skill models help",
      usage: "image-skill models <list|show> --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-models",
      subcommands: ["list", "show"],
    },
    "models list": {
      command: "image-skill models list help",
      usage:
        "image-skill models list --available --operation image.generate --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-models",
      optional_flags: [
        "--available",
        "--executable",
        "--catalog-only",
        "--operation",
        "--modality",
        "--provider",
        "--query",
        "--summary",
        "--details",
      ],
    },
    "models show": {
      command: "image-skill models show help",
      usage: "image-skill models show MODEL_ID --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-models",
    },
    capabilities: {
      command: "image-skill capabilities help",
      usage: "image-skill capabilities <list|show> --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-capabilities",
      subcommands: ["list", "show"],
    },
    "capabilities list": {
      command: "image-skill capabilities list help",
      usage: "image-skill capabilities list --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-capabilities",
    },
    "capabilities show": {
      command: "image-skill capabilities show help",
      usage: "image-skill capabilities show CAPABILITY_ID --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-capabilities",
    },
    create: {
      command: "image-skill create help",
      usage:
        'image-skill create --prompt "..." --intent explore --max-estimated-usd-per-image 0.07 --json',
      docs_url: "https://image-skill.com/cli.md#image-skill-create",
      optional_flags: [
        "--guide",
        "--dry-run",
        "--model",
        "--aspect-ratio",
        "--output-count",
        "--element-frontal",
        "--element-reference",
        "--reference-image",
        "--model-parameters-json",
        "--idempotency-key",
      ],
    },
    upload: {
      command: "image-skill upload help",
      usage: "image-skill upload PATH_OR_URL --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-upload",
    },
    edit: {
      command: "image-skill edit help",
      usage: 'image-skill edit --input image_... --prompt "..." --json',
      docs_url: "https://image-skill.com/cli.md#image-skill-edit",
      required_flags: ["--input"],
      optional_flags: [
        "--guide",
        "--dry-run",
        "--prompt",
        "--model",
        "--mask",
        "--element-reference",
        "--element-frontal",
        "--reference-image",
        "--model-parameters-json",
        "--idempotency-key",
      ],
    },
    assets: {
      command: "image-skill assets help",
      usage: "image-skill assets <show|get> ASSET_ID_OR_URL --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-assets",
      subcommands: ["show", "get"],
    },
    "assets show": {
      command: "image-skill assets show help",
      usage: "image-skill assets show ASSET_ID_OR_URL --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-assets",
    },
    "assets get": {
      command: "image-skill assets get help",
      usage: "image-skill assets get ASSET_ID_OR_URL --output PATH --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-assets",
    },
    jobs: {
      command: "image-skill jobs help",
      usage: "image-skill jobs <show|wait> JOB_ID --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-jobs",
      subcommands: ["show", "wait"],
    },
    "jobs show": {
      command: "image-skill jobs show help",
      usage: "image-skill jobs show JOB_ID --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-jobs",
    },
    "jobs wait": {
      command: "image-skill jobs wait help",
      usage: "image-skill jobs wait JOB_ID --timeout-ms 30000 --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-jobs",
    },
    activity: {
      command: "image-skill activity help",
      usage: "image-skill activity <list|show> --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-activity",
      subcommands: ["list", "show"],
    },
    "activity list": {
      command: "image-skill activity list help",
      usage: "image-skill activity list --subject JOB_ID --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-activity",
    },
    "activity show": {
      command: "image-skill activity show help",
      usage: "image-skill activity show REFERENCE --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-activity",
    },
    feedback: {
      command: "image-skill feedback help",
      usage: "image-skill feedback create --title TITLE --body BODY --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-feedback",
      subcommands: ["create"],
    },
    "feedback create": {
      command: "image-skill feedback create help",
      usage:
        "image-skill feedback create --title TITLE --body BODY --type user_feedback --json",
      docs_url: "https://image-skill.com/cli.md#image-skill-feedback",
      optional_flags: [
        "--title",
        "--body",
        "--type",
        "--severity",
        "--confidence",
        "--expected",
        "--actual",
        "--command",
      ],
    },
  }[key];
}

async function doctor(argv) {
  const args = parseArgs(argv);
  const apiBaseUrl = apiBase(args);
  const config = await readConfig(configPath());
  const inFlight = await inFlightSpendDoctorReport({
    sweep: flagBool(args, "sweep-in-flight"),
    now: new Date(),
  });
  const health = await apiRequest({
    command: "image-skill doctor",
    method: "GET",
    apiBaseUrl,
    path: "/healthz",
  });
  return success("image-skill doctor", {
    cli_version: VERSION,
    package: "image-skill",
    mode: "public_hosted_cli",
    api_base_url: apiBaseUrl,
    hosted_api: {
      reachable: health.envelope.ok,
      status: health.envelope.data?.status ?? null,
      api_version: health.envelope.data?.api_version ?? null,
      error: health.envelope.error,
    },
    auth: {
      config_path: configPath(),
      saved_token: config.tokenPresent,
      env_token: hasEnvToken(),
    },
    in_flight: inFlight,
    docs: {
      skill: AGENT_SKILL_URL,
      llms: AGENT_LLMS_URL,
      cli: AGENT_CLI_DOCS_URL,
    },
    agent_skill: agentSkillHint(),
  });
}

async function trust(argv) {
  const args = parseArgs(argv);
  const unsupportedFlags = [...args.flags.keys()].filter(
    (flag) => !["json", "api-base-url", "token", "token-stdin"].includes(flag),
  );
  if (args.positionals.length > 0 || unsupportedFlags.length > 0) {
    return invalid(
      "image-skill trust",
      unsupportedFlags.length > 0
        ? `unsupported flags for trust: ${unsupportedFlags.map((flag) => `--${flag}`).join(", ")}`
        : "trust does not accept positional arguments",
    );
  }
  const tokenHandoff = await acceptNoAuthTokenHandoff(
    args,
    "image-skill trust",
  );
  if (tokenHandoff !== null) {
    return tokenHandoff;
  }

  const checkedAt = new Date().toISOString();
  const apiBaseUrl = apiBase(args);
  const docsBaseUrl = docsBaseForApiBaseUrl(apiBaseUrl);
  const npmRegistryBaseUrl = npmRegistryBaseForApiBaseUrl(apiBaseUrl);

  const [npmPackage, hostedContracts, health, models] = await Promise.all([
    inspectNpmPackage({
      checkedAt,
      registryBaseUrl: npmRegistryBaseUrl,
    }),
    inspectHostedContracts({
      checkedAt,
      docsBaseUrl,
    }),
    apiRequest({
      command: "image-skill trust",
      method: "GET",
      apiBaseUrl,
      path: "/healthz",
    }),
    apiRequest({
      command: "image-skill trust",
      method: "GET",
      apiBaseUrl,
      path: "/v1/models",
    }),
  ]);

  const hostedApi = trustHostedApi(health, apiBaseUrl, checkedAt);
  const modelRegistry = trustModelRegistry(models, apiBaseUrl, checkedAt);
  const publicRepo = trustPublicRepo(npmPackage);
  const proofUrls = trustProofUrls({
    npmPackage,
    hostedContracts,
    publicRepo,
  });
  const warnings = trustWarnings({
    npmPackage,
    hostedContracts,
    hostedApi,
    modelRegistry,
    proofUrls,
  });
  const summary = trustSummary({
    warnings,
    npmPackage,
    hostedContracts,
    hostedApi,
    modelRegistry,
  });

  return success(
    "image-skill trust",
    {
      schema: "image-skill.trust-packet.v0",
      checked_at: checkedAt,
      subject: {
        package: PACKAGE_NAME,
        cli_version: VERSION,
        mode: "public_hosted_cli",
        api_base_url: apiBaseUrl,
        docs_base_url: docsBaseUrl,
        npm_registry_url: npmRegistryBaseUrl,
      },
      summary,
      npm_package: npmPackage,
      public_repo: publicRepo,
      hosted_contracts: hostedContracts,
      hosted_api: hostedApi,
      model_registry: modelRegistry,
      safe_commands: trustSafeCommands(),
      proof_urls: proofUrls,
      redaction: {
        secrets_included: false,
        private_paths_included: false,
        config_file_read: false,
        token_sources_read: false,
        credential_values_read: false,
        forbidden_material:
          "tokens, API keys, private repo paths, provider credentials, payment credentials, card data, wallet secrets, and private package metadata",
      },
    },
    warnings,
  );
}

async function signup(argv) {
  const args = parseArgs(argv);
  if (!flagBool(args, "agent")) {
    return invalid("image-skill signup", "signup currently requires --agent");
  }
  const contact = signupContact(args);
  const agentName = flagString(args, "agent-name");
  const runtime = flagString(args, "runtime");
  if (!contact.ok) {
    return failure(
      "image-skill signup",
      2,
      "INVALID_ARGUMENTS",
      contact.message,
      false,
      {
        required_flags: ["--agent-name", "--runtime"],
        optional_flags: ["--agent-contact", "--discovery-source"],
        suggested_command: SIGNUP_SUGGESTED_COMMAND,
        docs_url: "https://image-skill.com/cli.md#image-skill-signup-agent",
      },
    );
  }
  // Anonymous signup is the default (decision 0030): only name + runtime are
  // required. A contact stays optional here and attachable later via
  // `claim request --contact INBOX`.
  if (agentName === null || runtime === null) {
    return failure(
      "image-skill signup",
      2,
      "INVALID_ARGUMENTS",
      `signup requires --agent-name and --runtime. ${SIGNUP_CONTACT_GUIDANCE}`,
      false,
      {
        required_flags: ["--agent-name", "--runtime"],
        optional_flags: ["--agent-contact", "--discovery-source"],
        accepted_aliases: {
          "--human-email": "--agent-contact",
        },
        suggested_command: SIGNUP_SUGGESTED_COMMAND,
        docs_url: "https://image-skill.com/cli.md#image-skill-signup-agent",
      },
    );
  }
  const showToken = flagBool(args, "show-token");
  const noSave = flagBool(args, "no-save");
  const saveRequested = flagBool(args, "save");
  if (saveRequested && noSave) {
    return invalid(
      "image-skill signup",
      "use either --save or --no-save, not both",
    );
  }
  const shouldSave = !noSave;
  if (shouldSave) {
    const configReady = await assertConfigWritable("image-skill signup");
    if (!configReady.ok) {
      return configReady.result;
    }
  }
  // Discovery-source attribution (#1814): self-reported channel slug from
  // --discovery-source or IMAGE_SKILL_DISCOVERY_SOURCE (flag wins). Omitted
  // entirely when absent — never guessed, never required.
  const discoverySource =
    flagString(args, "discovery-source")?.trim() ||
    process.env.IMAGE_SKILL_DISCOVERY_SOURCE?.trim() ||
    null;
  const result = await apiRequest({
    command: "image-skill signup",
    method: "POST",
    apiBaseUrl: apiBase(args),
    path: "/v1/agent-signups",
    body: {
      ...(contact.value === null ? {} : { agent_contact: contact.value }),
      agent_name: agentName,
      runtime,
      return_token: shouldSave || showToken,
      ...(discoverySource === null || discoverySource === ""
        ? {}
        : { discovery_source: discoverySource }),
    },
  });
  result.envelope.command = "image-skill signup";
  rewriteSignupContactFailure(result);

  const token = result.envelope.data?.token;
  const warnings = result.envelope.warnings.filter(
    (warning) => warning !== HOSTED_SIGNUP_TOKEN_RETURNED_WARNING,
  );
  if (result.envelope.ok && shouldSave) {
    if (typeof token !== "string" || token.trim().length === 0) {
      return failure(
        "image-skill signup",
        3,
        "AUTH_REQUIRED",
        "hosted signup did not return the restricted token needed for local auth save",
        false,
        {
          suggested_command: `${SIGNUP_SUGGESTED_COMMAND} --show-token --no-save`,
          docs_url: "https://image-skill.com/cli.md#image-skill-signup-agent",
        },
      );
    }
    try {
      await saveConfig({
        api_base_url: apiBase(args),
        token: token.trim(),
        saved_at: new Date().toISOString(),
        actor: null,
      });
    } catch (error) {
      return configWriteFailure("image-skill signup", error);
    }
  }
  if (result.envelope.ok && showToken) {
    warnings.push(
      shouldSave
        ? "hosted restricted token was also returned once because --show-token was set; keep it out of prompts, logs, issue text, and feedback"
        : "hosted restricted token was returned once because --show-token --no-save was set; store it in the agent runtime secret store and use IMAGE_SKILL_TOKEN or --token-stdin for later commands",
    );
  }

  if (result.envelope.data && typeof result.envelope.data === "object") {
    const publicData = publicSignupData(result.envelope.data);
    result.envelope.data = {
      ...publicData,
      token: showToken ? (token ?? publicData.token ?? null) : null,
      token_presented: showToken,
      storage: {
        ...(publicData.storage ?? {}),
        saved: shouldSave,
        config_path: shouldSave ? configPath() : null,
        reason: shouldSave
          ? "auth is ready in the public CLI config; no raw token copy step is required"
          : showToken
            ? "hosted signup returned the token once for the agent runtime secret store"
            : "hosted signup did not request a raw token or save config because --no-save was set",
      },
      auth_handoff: {
        status: shouldSave
          ? "saved_config_ready"
          : showToken
            ? "manual_token_handoff"
            : "not_saved",
        saved_auth_ready: shouldSave,
        accepted_methods: ["config", "IMAGE_SKILL_TOKEN", "--token-stdin"],
        token_source_after_signup: shouldSave ? "config" : "not_saved",
        secret_value_included: showToken,
        raw_token_copy_required: !shouldSave,
        rerun_guide_hint: shouldSave
          ? "Rerun the guide command you just ran; the CLI will authenticate from saved config."
          : "Rerun the guide with IMAGE_SKILL_TOKEN or --token-stdin after storing the returned token.",
        next_step: shouldSave
          ? "Run whoami, usage quota, feedback create, credits, create, or edit normally; the CLI will read the saved config."
          : "Store data.token in the agent runtime secret store immediately, then pass it with IMAGE_SKILL_TOKEN or --token-stdin.",
      },
    };
  }
  result.envelope.warnings = warnings;
  return result;
}

// Claim request (decision 0030): attach an email-shaped durable contact to the
// authenticated agent after an (often anonymous) signup — the on-demand
// identity upgrade for funding notices and durability. claim_state stays
// unclaimed; attaching a contact is not inbox-ownership verification.
async function claim(argv) {
  const [subcommand, ...rest] = argv;
  if (subcommand !== "request") {
    return failure(
      "image-skill claim",
      2,
      "INVALID_ARGUMENTS",
      "claim requires the request subcommand",
      false,
      {
        suggested_command: CLAIM_REQUEST_SUGGESTED_COMMAND,
        docs_url: "https://image-skill.com/cli.md#image-skill-claim-request",
      },
    );
  }
  const args = parseArgs(rest);
  const contact = flagString(args, "contact");
  if (contact === null || contact.trim().length === 0) {
    return failure(
      "image-skill claim request",
      2,
      "INVALID_ARGUMENTS",
      "claim request requires --contact, an email-shaped durable contact inbox (agent-owned when available, otherwise an operator, team, or sponsor inbox)",
      false,
      {
        required_flags: ["--contact"],
        suggested_command: CLAIM_REQUEST_SUGGESTED_COMMAND,
        docs_url: "https://image-skill.com/cli.md#image-skill-claim-request",
      },
    );
  }
  const token = await resolveToken(args);
  if (!token.ok) {
    return token.result;
  }
  return apiRequest({
    command: "image-skill claim request",
    method: "POST",
    apiBaseUrl: apiBase(args),
    path: "/v1/agent-claims",
    token: token.token,
    body: { contact: contact.trim().toLowerCase() },
  });
}

function rewriteSignupContactFailure(result) {
  const error = result.envelope.error;
  if (
    error !== null &&
    typeof error === "object" &&
    (error.message === "human_email must be a valid email address" ||
      error.message ===
        "agent_contact must be an email-shaped durable contact inbox" ||
      error.message ===
        "human_email is a legacy alias for agent_contact and must be an email-shaped durable contact inbox")
  ) {
    error.message =
      "--agent-contact, when provided, must be an email-shaped durable contact inbox; signup itself is anonymous by default, so omit the flag entirely if no durable inbox exists";
    error.recovery = {
      ...(error.recovery ?? {}),
      suggested_command: SIGNUP_SUGGESTED_COMMAND,
      docs_url: "https://image-skill.com/cli.md#image-skill-signup-agent",
    };
  }
}

function publicSignupData(data) {
  const { human_email: humanEmail, ...rest } = data;
  const agentContact =
    typeof rest.agent_contact === "string" ? rest.agent_contact : humanEmail;
  return {
    ...rest,
    ...(typeof agentContact === "string"
      ? { agent_contact: agentContact }
      : {}),
  };
}

async function auth(argv) {
  const [subcommand, ...rest] = argv;
  const args = parseArgs(rest);
  if (subcommand === "status") {
    const token = await resolveToken(args);
    if (!token.ok) {
      return success("image-skill auth status", {
        authenticated: false,
        source: null,
        config_path: configPath(),
      });
    }
    const result = await apiRequest({
      command: "image-skill auth status",
      method: "GET",
      apiBaseUrl: apiBase(args),
      path: "/v1/whoami",
      token: token.token,
    });
    if (result.envelope.data && typeof result.envelope.data === "object") {
      result.envelope.data = {
        ...result.envelope.data,
        auth_source: token.source,
      };
    }
    return result;
  }
  if (subcommand === "save") {
    const token = await resolveToken(args, { allowSaved: false });
    if (!token.ok) {
      return token.result;
    }
    const configReady = await assertConfigWritable("image-skill auth save");
    if (!configReady.ok) {
      return configReady.result;
    }
    try {
      await saveConfig({
        api_base_url: apiBase(args),
        token: token.token,
        saved_at: new Date().toISOString(),
        actor: null,
      });
    } catch (error) {
      return configWriteFailure("image-skill auth save", error);
    }
    return success("image-skill auth save", {
      saved: true,
      config_path: configPath(),
      token_source: token.source,
    });
  }
  if (subcommand === "logout") {
    await rm(configPath(), { force: true });
    return success("image-skill auth logout", {
      saved: false,
      config_path: configPath(),
    });
  }
  return invalid("image-skill auth", "auth requires status, save, or logout");
}

async function whoami(argv) {
  const args = parseArgs(argv);
  const token = await resolveToken(args);
  if (!token.ok) {
    return token.result;
  }
  return apiRequest({
    command: "image-skill whoami",
    method: "GET",
    apiBaseUrl: apiBase(args),
    path: "/v1/whoami",
    token: token.token,
  });
}

async function usage(argv) {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined || subcommand.startsWith("-")) {
    return await quota(argv, "image-skill usage quota");
  }
  if (subcommand !== "quota") {
    return invalid("image-skill usage", "usage requires the quota subcommand");
  }
  return quota(rest, "image-skill usage quota");
}

async function quota(argv, command = "image-skill quota") {
  const args = parseArgs(argv);
  const token = await resolveToken(args);
  if (!token.ok) {
    return withCommand(token.result, command);
  }
  return withQuotaNextActions(
    withCommand(
      await apiRequest({
        command,
        method: "GET",
        apiBaseUrl: apiBase(args),
        path: "/v1/quota",
        token: token.token,
      }),
      command,
    ),
  );
}

async function credits(argv) {
  const [subcommand, ...rest] = argv;
  if (subcommand === "methods") {
    const args = parseArgs(rest);
    const unknownFlags = [...args.flags.keys()].filter(
      (flag) =>
        !["json", "api-base-url", "token", "token-stdin"].includes(flag),
    );
    if (args.positionals.length > 0 || unknownFlags.length > 0) {
      return invalid(
        "image-skill credits methods",
        unknownFlags.length > 0
          ? `unsupported flags for credits methods: ${unknownFlags.map((flag) => `--${flag}`).join(", ")}`
          : "credits methods does not accept positional arguments",
      );
    }
    const tokenHandoff = await acceptNoAuthTokenHandoff(
      args,
      "image-skill credits methods",
    );
    if (tokenHandoff !== null) {
      return tokenHandoff;
    }
    return withCopyRunnablePaymentMethodCommands(
      await apiRequest({
        command: "image-skill credits methods",
        method: "GET",
        apiBaseUrl: apiBase(args),
        path: "/v1/payment-methods",
      }),
      createGuideCommandPrefix(),
    );
  }
  if (subcommand === "packs") {
    const [packsSubcommand, ...packsRest] = rest;
    if (packsSubcommand !== "list") {
      return invalid(
        "image-skill credits packs",
        "credits packs requires the list subcommand",
      );
    }
    const args = parseArgs(packsRest);
    const unknownFlags = [...args.flags.keys()].filter(
      (flag) =>
        !["json", "api-base-url", "token", "token-stdin"].includes(flag),
    );
    if (args.positionals.length > 0 || unknownFlags.length > 0) {
      return invalid(
        "image-skill credits packs list",
        unknownFlags.length > 0
          ? `unsupported flags for credits packs list: ${unknownFlags.map((flag) => `--${flag}`).join(", ")}`
          : "credits packs list does not accept positional arguments",
      );
    }
    const tokenHandoff = await acceptNoAuthTokenHandoff(
      args,
      "image-skill credits packs list",
    );
    if (tokenHandoff !== null) {
      return tokenHandoff;
    }
    return apiRequest({
      command: "image-skill credits packs list",
      method: "GET",
      apiBaseUrl: apiBase(args),
      path: "/v1/credit-packs",
    });
  }
  if (subcommand === "quote") {
    const args = parseArgs(rest);
    const credentialFlag = rejectPaymentCredentialFlags(
      args,
      "image-skill credits quote",
    );
    if (credentialFlag !== null) {
      return credentialFlag;
    }
    const creditsValue = flagNumber(args, "credits");
    const pack = flagString(args, "pack");
    if (creditsValue === null && pack === null) {
      return invalid(
        "image-skill credits quote",
        "credits quote requires --pack PACK_ID or --credits N",
      );
    }
    const idempotency = optionalIdempotencyKey(args, "quote");
    const paymentMethod = flagString(args, "payment-method");
    const PUBLIC_QUOTE_PAYMENT_METHODS = [
      "stripe_checkout",
      "stripe_x402.exact.usdc",
    ];
    if (paymentMethod === null) {
      return invalid(
        "image-skill credits quote",
        "credits quote requires --payment-method from credits methods; use stripe_x402.exact.usdc for an agent-settleable browserless rail or stripe_checkout for a human Checkout handoff",
      );
    }
    if (!PUBLIC_QUOTE_PAYMENT_METHODS.includes(paymentMethod)) {
      return invalid(
        "image-skill credits quote",
        `public credits quote supports --payment-method ${PUBLIC_QUOTE_PAYMENT_METHODS.join(" or ")}`,
      );
    }
    const token = await resolveToken(args);
    if (!token.ok) {
      return withCreditQuoteAuthRecovery(token.result, {
        args,
        creditsValue,
        pack,
        paymentMethod,
        idempotency,
      });
    }
    const body = {
      ...(creditsValue === null ? {} : { credits: creditsValue }),
      ...(pack === null ? {} : { pack_id: pack }),
      payment_method: paymentMethod,
      idempotency_key: idempotency.value,
    };
    const commandPrefix = createGuideCommandPrefix();
    const result = withCopyRunnableQuotaRecoveryCommands(
      await apiRequest({
        command: "image-skill credits quote",
        method: "POST",
        apiBaseUrl: apiBase(args),
        path: "/v1/credit-quotes",
        token: token.token,
        body,
      }),
      commandPrefix,
    );
    if (idempotency.generated) {
      result.envelope.warnings.push(
        `generated idempotency key ${idempotency.value}; pass --idempotency-key for stable retries`,
      );
    }
    return withCopyRunnableCreditQuoteCommands(result, commandPrefix);
  }
  if (subcommand === "buy") {
    const args = parseArgs(rest);
    const credentialFlag = rejectPaymentCredentialFlags(
      args,
      "image-skill credits buy",
    );
    if (credentialFlag !== null) {
      return credentialFlag;
    }
    const provider = flagString(args, "provider");
    if (provider !== "stripe" && provider !== "stripe_x402") {
      return invalid(
        "image-skill credits buy",
        "credits buy supports --provider stripe (hosted checkout) or --provider stripe_x402 (agent-native USDC deposit)",
      );
    }
    const quoteId = flagString(args, "quote-id");
    if (quoteId === null) {
      return invalid(
        "image-skill credits buy",
        "credits buy requires --quote-id",
      );
    }
    const token = await resolveToken(args);
    if (!token.ok) {
      return token.result;
    }
    const idempotency = requiredIdempotencyKey(
      args,
      "image-skill credits buy",
      "credits buy creates or replays a payment purchase and requires --idempotency-key for retry-safe payment mutation",
    );
    if (!idempotency.ok) {
      return idempotency.result;
    }
    const purchasePath =
      provider === "stripe_x402"
        ? "/v1/credit-purchases/stripe-x402-deposits"
        : "/v1/credit-purchases/stripe-checkout-sessions";
    const commandPrefix = createGuideCommandPrefix();
    const result = withCopyRunnableQuotaRecoveryCommands(
      await apiRequest({
        command: "image-skill credits buy",
        method: "POST",
        apiBaseUrl: apiBase(args),
        path: purchasePath,
        token: token.token,
        body: {
          quote_id: quoteId,
          idempotency_key: idempotency.value,
        },
      }),
      commandPrefix,
    );
    return withCopyRunnablePaymentNextActionCommands(
      withStripeCheckoutCopyFallback(result),
      commandPrefix,
    );
  }
  if (subcommand === "status") {
    const args = parseArgs(rest);
    const token = await resolveToken(args);
    if (!token.ok) {
      return token.result;
    }
    const query = new URLSearchParams();
    addQueryFlag(query, args, "quote-id", "quote_id");
    addQueryFlag(query, args, "payment-attempt-id", "payment_attempt_id");
    addQueryFlag(query, args, "checkout-session-id", "checkout_session_id");
    addQueryFlag(query, args, "receipt-id", "receipt_id");
    const commandPrefix = createGuideCommandPrefix();
    const result = withCopyRunnableQuotaRecoveryCommands(
      await apiRequest({
        command: "image-skill credits status",
        method: "GET",
        apiBaseUrl: apiBase(args),
        path: `/v1/credit-purchases/status?${query.toString()}`,
        token: token.token,
      }),
      commandPrefix,
    );
    return withCopyRunnablePaymentNextActionCommands(
      withStripeCheckoutCopyFallback(result),
      commandPrefix,
    );
  }
  return invalid(
    "image-skill credits",
    "credits requires methods, packs, quote, buy, or status",
  );
}

async function acceptNoAuthTokenHandoff(args, command) {
  const tokenValues = args.flags.get("token");
  if (tokenValues !== undefined && typeof tokenValues.at(-1) !== "string") {
    return invalid(command, "token requires a value");
  }
  if (flagBool(args, "token-stdin") && tokenValues !== undefined) {
    return invalid(command, "use either --token or --token-stdin, not both");
  }
  if (!flagBool(args, "token-stdin")) {
    return null;
  }
  if (process.stdin.isTTY) {
    return invalid(command, "--token-stdin requires a token piped on stdin");
  }
  const token = (await readStdin()).trim();
  if (token.length === 0) {
    return failure(
      command,
      3,
      "AUTH_REQUIRED",
      "--token-stdin received empty stdin",
      false,
    );
  }
  return null;
}

async function models(argv) {
  const [subcommand, ...rest] = argv;
  const args = parseArgs(
    subcommand === "list" || subcommand === "show" ? rest : argv,
  );
  if (subcommand === "show") {
    if (args.positionals.length !== 1) {
      return invalid(
        "image-skill models show",
        "models show requires exactly one MODEL_ID",
      );
    }
    const modelId = args.positionals[0];
    return apiRequest({
      command: "image-skill models show",
      method: "GET",
      apiBaseUrl: apiBase(args),
      path: `/v1/models/${encodeURIComponent(modelId)}`,
    });
  }
  if (
    subcommand !== undefined &&
    subcommand !== "list" &&
    !subcommand.startsWith("--")
  ) {
    return invalid("image-skill models", "models supports list or show");
  }
  const query = modelListQuery(args);
  if (!query.ok) {
    return invalid(
      subcommand === "list" ? "image-skill models list" : "image-skill models",
      query.message,
    );
  }
  const result = await apiRequest({
    command:
      subcommand === "list" ? "image-skill models list" : "image-skill models",
    method: "GET",
    apiBaseUrl: apiBase(args),
    path: query.path,
  });
  return flagBool(args, "details") ? result : withModelSummary(result);
}

function modelListQuery(args) {
  const available = flagBool(args, "available");
  const executable = flagBool(args, "executable");
  const catalogOnly = flagBool(args, "catalog-only");
  const summary = flagBool(args, "summary");
  const details = flagBool(args, "details");
  if (summary && details) {
    return {
      ok: false,
      message: "models list --summary cannot be combined with --details",
    };
  }
  if (catalogOnly && (available || executable)) {
    return {
      ok: false,
      message:
        "models list --catalog-only cannot be combined with --available or --executable",
    };
  }
  const params = new URLSearchParams();
  if (available) {
    params.set("available", "true");
  }
  if (executable) {
    params.set("executable", "true");
  }
  if (catalogOnly) {
    params.set("catalog_only", "true");
  }
  if (details) {
    params.set("details", "true");
  }
  addQueryValue(params, "operation", flagString(args, "operation"));
  addQueryValue(params, "modality", flagString(args, "modality"));
  addQueryValue(params, "provider", flagString(args, "provider"));
  addQueryValue(params, "query", flagString(args, "query"));
  const query = params.toString();
  return {
    ok: true,
    path: query.length === 0 ? "/v1/models" : `/v1/models?${query}`,
  };
}

function withModelSummary(result) {
  const data = result.envelope.data;
  if (!isRecord(data) || !Array.isArray(data.models)) {
    return result;
  }
  if (data.summary?.result_shape === "compact_model_summary") {
    return result;
  }
  return {
    ...result,
    envelope: {
      ...result.envelope,
      data: {
        ...data,
        summary: {
          ...(isRecord(data.summary) ? data.summary : {}),
          result_shape: "compact_model_summary",
          full_list_command: "image-skill models list --details --json",
        },
        models: data.models.map(modelSummaryRow),
      },
    },
  };
}

function modelSummaryRow(model) {
  return {
    id: model.id,
    default: model.default === true,
    display_name: model.display_name,
    provider_id: model.provider_id,
    mode: model.mode,
    status: model.status,
    availability_reason: model.availability_reason ?? null,
    modality: model.modality ?? "image",
    supports: Array.isArray(model.supports) ? [...model.supports] : [],
    operations: Array.isArray(model.operations) ? [...model.operations] : [],
    task_tags: modelSummaryTaskTags(model),
    estimated_usd_per_image: model.economics?.estimated_usd_per_image ?? null,
    credits_required: model.economics?.credit_pricing?.credits_required ?? null,
    pricing_confidence:
      model.economics?.credit_pricing?.pricing_confidence ?? null,
    cost_known: model.economics?.cost_known ?? false,
    budget_required_for_live:
      model.economics?.budget_required_for_live ?? false,
    max_outputs_per_request:
      model.media?.output?.max_outputs_per_request ?? null,
    max_resolution: model.media?.output?.max_resolution ?? null,
    artifact_storage: model.execution?.artifact_storage ?? null,
    model_execution_status: model.execution?.model_execution_status ?? null,
    grants_required: Array.isArray(model.capability?.grants_required)
      ? [...model.capability.grants_required]
      : [],
    show_command:
      typeof model.id === "string"
        ? `image-skill models show ${model.id} --json`
        : "image-skill models show MODEL_ID --json",
  };
}

function modelSummaryTaskTags(model) {
  const tags = [];
  const seen = new Set();
  const add = (tag) => {
    if (!seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  };
  for (const support of Array.isArray(model.supports) ? model.supports : []) {
    add(support);
  }
  for (const operation of Array.isArray(model.operations)
    ? model.operations
    : []) {
    add(operationTag(operation));
  }
  for (const intent of Array.isArray(model.capability?.intents)
    ? model.capability.intents
    : []) {
    add(intent);
  }
  if (
    model.operations?.includes("image.generate") &&
    model.media?.input?.images?.required !== true &&
    model.media?.input?.references?.required !== true
  ) {
    add("text-to-image");
  }
  if (model.media?.input?.images?.required === true) {
    add("input-image");
    add("image-to-image");
  }
  if (model.media?.input?.mask?.supported === true) {
    add(model.media?.input?.mask?.required === true ? "mask-required" : "mask");
  }
  if (model.media?.input?.references?.supported === true) {
    add("reference-image");
    if ((model.media?.input?.references?.max ?? 0) > 1) {
      add("multi-reference");
    }
  }
  if (model.media?.output?.transparent_background === true) {
    add("transparent-background");
  }
  if ((model.media?.output?.max_outputs_per_request ?? 0) > 1) {
    add("multi-output");
  }
  if (
    String(model.id ?? "").includes("video") ||
    String(model.display_name ?? "")
      .toLowerCase()
      .includes("video")
  ) {
    add("video");
  }
  if (model.execution?.artifact_storage === "image_skill_owned") {
    add("downloadable");
  }
  return tags;
}

function operationTag(operation) {
  if (operation === "image.generate") return "generate";
  if (operation === "image.edit") return "edit";
  if (operation === "image.variation") return "variation";
  if (operation === "image.upscale") return "upscale";
  if (operation === "image.utility") return "utility";
  if (operation === "image.vision") return "vision";
  return "inspect";
}

function addQueryValue(params, name, value) {
  if (typeof value === "string" && value.trim().length > 0) {
    params.set(name, value.trim());
  }
}

async function capabilities(argv) {
  const [subcommand, ...rest] = argv;
  const args = parseArgs(
    subcommand === "list" || subcommand === "show" ? rest : argv,
  );
  if (subcommand === "show") {
    const capabilityId = args.positionals[0];
    if (capabilityId === undefined) {
      return invalid(
        "image-skill capabilities show",
        "capabilities show requires CAPABILITY_ID",
      );
    }
    return apiRequest({
      command: "image-skill capabilities show",
      method: "GET",
      apiBaseUrl: apiBase(args),
      path: `/v1/capabilities/${encodeURIComponent(capabilityId)}`,
    });
  }
  if (
    subcommand !== undefined &&
    subcommand !== "list" &&
    !subcommand.startsWith("--")
  ) {
    return invalid(
      "image-skill capabilities",
      "capabilities supports list or show",
    );
  }
  return apiRequest({
    command:
      subcommand === "list"
        ? "image-skill capabilities list"
        : "image-skill capabilities",
    method: "GET",
    apiBaseUrl: apiBase(args),
    path: "/v1/capabilities",
  });
}

async function createGuide(args, options = {}) {
  const guideOperation = options.guideOperation ?? "create";
  const command = `image-skill ${guideOperation} --guide`;
  if (flagBool(args, "dry-run")) {
    return invalid(
      command,
      `${guideOperation} --guide cannot be combined with --dry-run; the guide returns the dry-run escape hatch separately`,
    );
  }
  if (hasReferenceFlags(args)) {
    return invalid(
      command,
      `${guideOperation} --guide does not upload or resolve reference images; inspect the model with models show, then run ${guideOperation} --dry-run before live referenced media calls`,
    );
  }
  const modelParameters = jsonObjectFlag(args, "model-parameters-json");
  if (!modelParameters.ok) {
    return modelParameters.result;
  }

  const apiBaseUrl = apiBase(args);
  const prompt = flagString(args, "prompt") ?? args.positionals[0] ?? "";
  const trimmedPrompt = prompt.trim();
  const requestedModelId = flagString(args, "model");
  const requestedProviderId = flagString(args, "provider");
  const requestedIntentFlag = flagString(args, "intent");
  const requestedIntent = requestedIntentFlag ?? "explore";
  const requestedModelParametersJson =
    modelParameters.value === null
      ? null
      : JSON.stringify(modelParameters.value);
  const maxEstimatedUsdPerImage = flagNumber(
    args,
    "max-estimated-usd-per-image",
  );
  const health = await apiRequest({
    command: "image-skill create --guide",
    method: "GET",
    apiBaseUrl,
    path: "/healthz",
  });
  const models = await apiRequest({
    command: "image-skill create --guide",
    method: "GET",
    apiBaseUrl,
    path: "/v1/models",
  });
  const payments = await apiRequest({
    command: "image-skill create --guide",
    method: "GET",
    apiBaseUrl,
    path: "/v1/payment-methods",
  });
  const token = await resolveToken(args, { allowMissing: true });
  if (!token.ok) {
    return token.result;
  }

  const selected =
    models.envelope.ok && models.envelope.data?.models
      ? selectCreateGuideModel(models.envelope.data.models, requestedModelId, {
          operation: guideOperation,
          prompt: trimmedPrompt,
          intent: requestedIntent,
          maxEstimatedUsdPerImage,
        })
      : null;
  const selectedAspectRatio = createGuideSuggestedAspectRatio(selected);
  const pricingContext = {
    aspectRatio: selectedAspectRatio ?? "1:1",
    outputCount: 1,
  };
  const defaultedModelParameters =
    selected === null || createGuideSelectedModelRequiresInputImage(selected)
      ? {
          modelParameters: modelParameters.value ?? {},
          defaultsApplied: [],
        }
      : createGuideDefaultModelParameters({
          model: selected,
          aspectRatio: pricingContext.aspectRatio,
          intent: requestedIntent,
          modelParameters: modelParameters.value ?? {},
          maxEstimatedUsdPerImage,
        });
  const shouldPriceModelParameters =
    selected !== null &&
    !createGuideSelectedModelRequiresInputImage(selected) &&
    createGuideCanPriceModelParameters(selected) &&
    (defaultedModelParameters.defaultsApplied.length > 0 ||
      Object.keys(modelParameters.value ?? {}).length > 0);
  const pricing =
    selected === null
      ? null
      : shouldPriceModelParameters
        ? createGuidePricingForModel(
            selected,
            defaultedModelParameters.modelParameters,
            pricingContext,
          )
        : createGuideModelCreditPricing(selected);
  const providerCostEstimate =
    selected === null || !shouldPriceModelParameters
      ? null
      : createGuideProviderCostEstimateForModel(
          selected,
          defaultedModelParameters.modelParameters,
          pricingContext,
        );
  const estimatedCredits = pricing?.credits_required ?? null;
  const estimatedProviderUsdPerImage =
    providerCostEstimate?.estimated_provider_cost_usd ??
    selected?.economics?.estimated_usd_per_image ??
    pricing?.fallback_provider_cost_usd ??
    (typeof selected?.estimated_usd_per_image === "number"
      ? selected.estimated_usd_per_image
      : null) ??
    null;
  const estimatedDebitUsdPerImage =
    pricing?.estimated_revenue_usd ?? estimatedProviderUsdPerImage;
  const budgetGuard =
    maxEstimatedUsdPerImage ??
    estimatedDebitUsdPerImage ??
    (estimatedCredits === null ? 0.07 : estimatedCredits / 100);
  const quotaCommandPrefix = createGuideCommandPrefix({
    configPath: configuredImageSkillConfigPath(),
  });
  const quota =
    token.token === null
      ? null
      : withQuotaNextActions(
          await apiRequest({
            command: "image-skill create --guide",
            method: "GET",
            apiBaseUrl,
            path: "/v1/quota",
            token: token.token,
          }),
          quotaCommandPrefix,
        );
  const authenticated = quota?.envelope.data?.authenticated === true;
  const publicTokenSource =
    token.source === "anonymous" ? "none" : token.source;
  const stage = createGuideStage({
    prompt: trimmedPrompt,
    promptRequired:
      trimmedPrompt.length === 0 &&
      (selected === null || !PROMPTLESS_EDIT_MODEL_IDS.has(selected.id)),
    health,
    models,
    selected,
    token,
    quota,
    estimatedCredits,
  });
  const authConfigWrite =
    stage === "auth_required" ? await probeConfigWritable() : null;
  const guideCommandPrefix = createGuideCommandPrefix({
    configPath:
      authConfigWrite?.ok === false
        ? LOCAL_WRITABLE_CONFIG_PATH
        : configuredImageSkillConfigPath(),
  });
  const paymentSummary = createGuidePaymentSummary(
    payments.envelope.data,
    guideCommandPrefix,
  );
  const blocker = createGuideBlocker(stage, {
    requestedModelId,
    quota,
    estimatedCredits,
  });
  const nextCommand = createGuideNextCommand(stage, {
    prompt: trimmedPrompt,
    selected,
    requestedProviderId,
    requestedIntent,
    requestedIntentFlag,
    requestedModelId,
    guideOperation,
    inputReference: options.inputReference,
    maxEstimatedUsdPerImage,
    budgetGuard,
    aspectRatio: selectedAspectRatio,
    modelParametersJson: requestedModelParametersJson,
    apiBaseUrl: explicitApiBaseUrl(args),
    paymentSummary,
    commandPrefix: guideCommandPrefix,
    authConfigWritable: authConfigWrite?.ok ?? true,
  });
  const nextCommandMissingInputs =
    createGuideNextCommandMissingInputs(nextCommand);
  const nextCommandCopyRunnable = nextCommandMissingInputs.length === 0;
  const escapeHatches = createGuideEscapeHatches({
    prompt: trimmedPrompt,
    selected,
    requestedProviderId,
    requestedIntent,
    requestedIntentFlag,
    requestedModelId,
    guideOperation,
    inputReference: options.inputReference,
    maxEstimatedUsdPerImage,
    budgetGuard,
    aspectRatio: selectedAspectRatio,
    modelParametersJson: requestedModelParametersJson,
    apiBaseUrl: explicitApiBaseUrl(args),
    commandPrefix: guideCommandPrefix,
  });
  const nextCommandEffect = createGuideNextCommandEffect(stage, {
    estimatedCredits,
    estimatedDebitUsdPerImage,
    nextCommandCopyRunnable,
    nextCommandMissingInputs,
  });
  const noSpendNextCommand =
    stage === "ready_to_create" ? escapeHatches.dry_run : null;
  const noSpendNextCommandLabel =
    noSpendNextCommand === null
      ? null
      : "dry_run_plan_no_provider_call_no_credit_debit_no_media_write";
  const noSpendNextCommandEffect = createGuideNoSpendNextCommandEffect(stage, {
    estimatedCredits,
    estimatedDebitUsdPerImage,
  });
  const noSpendEvaluation = createGuideNoSpendEvaluation(stage, {
    noSpendNextCommand,
    noSpendNextCommandLabel,
    noSpendNextCommandEffect,
  });
  const guideWarning = createGuideWarning(stage, {
    nextCommandEffect,
    paymentSummary,
    nextCommandCopyRunnable,
  });
  const quotaTopUp = createGuideQuotaTopUp(
    quota?.envelope.data?.top_up ?? null,
  );
  const afterNext =
    stage === "auth_required" || stage === "quota_required"
      ? renderGuideCommand(
          trimmedPrompt,
          explicitApiBaseUrl(args),
          guideCommandPrefix,
          {
            operation: guideOperation,
            inputReference: options.inputReference,
            modelId: requestedModelId,
            providerId: requestedProviderId,
            intent: requestedIntentFlag,
            maxEstimatedUsdPerImage,
            modelParametersJson: requestedModelParametersJson,
          },
        )
      : null;
  const authHandoff = createGuideAuthHandoff(stage, {
    tokenSource: token.source,
    nextCommand,
    afterNext,
    authConfigWrite,
  });
  const authReady = createGuideAuthReady(stage, {
    authenticated,
    tokenSource: publicTokenSource,
    savedConfigPath: configPath(),
    nextCommandCopyRunnable,
  });
  const selfFundHandoff = createGuideSelfFundHandoff(stage, {
    paymentSummary,
    nextCommand,
    afterNext,
    tokenSource: publicTokenSource,
    commandPrefix: guideCommandPrefix,
    quotaTopUp,
  });
  const selfFundPreparation = createGuideSelfFundPreparation(stage, {
    paymentSummary,
    quotaTopUp,
    afterNext,
    tokenSource: publicTokenSource,
  });
  const selfFundNextCommand =
    stage === "quota_required"
      ? nextCommand
      : createGuidePreWallSelfFundNextCommand(selfFundPreparation);
  const selfFundNextCommandLabel = createGuideSelfFundNextCommandLabel(
    stage,
    paymentSummary,
    selfFundPreparation,
  );
  const guideRecovery = createGuideRecovery(stage, {
    blocker,
    nextCommand,
    noSpendNextCommand,
    afterNext,
    escapeHatches,
    selfFundNextCommand,
  });
  return createGuideSuccess(command, quota?.envelope.actor ?? null, {
    schema:
      guideOperation === "edit"
        ? "image-skill.edit-guide.v1"
        : "image-skill.create-guide.v1",
    agent_skill: agentSkillHint(guideCommandPrefix),
    ready: stage === "ready_to_create",
    stage,
    checks: {
      hosted_api: {
        reachable: health.envelope.ok,
        status: health.envelope.data?.status ?? null,
        api_base_url: apiBaseUrl,
        error_code: health.envelope.error?.code ?? null,
      },
      auth: {
        source: publicTokenSource,
        authenticated,
        claim_state: quota?.envelope.data?.claim_state ?? null,
        token_status: quota?.envelope.data?.token_status ?? null,
        saved_config_path: configPath(),
        config_write:
          authConfigWrite === null
            ? null
            : publicConfigWriteStatus(
                authConfigWrite,
                "image-skill create --guide",
              ),
      },
      models: {
        reachable: models.envelope.ok,
        executable_count: models.envelope.data?.summary?.executable ?? 0,
        cataloged_not_wired_count:
          models.envelope.data?.summary?.cataloged_not_wired ?? 0,
        error_code: models.envelope.error?.code ?? null,
      },
      quota: {
        checked: quota !== null,
        authenticated: quota?.envelope.data?.authenticated === true,
        remaining_credits: quotaRemainingCredits(quota?.envelope.data ?? null),
        required_credits: estimatedCredits,
        daily_jobs_remaining:
          quota?.envelope.data?.daily_jobs?.remaining ?? null,
        top_up: quotaTopUp,
        reason:
          quota === null
            ? "auth_required"
            : quota.envelope.ok
              ? null
              : (quota.envelope.error?.code ?? "quota_unavailable"),
      },
      payments: paymentSummary,
    },
    selection:
      selected === null
        ? null
        : {
            operation: createGuideSelectedModelRequiresInputImage(selected)
              ? "edit"
              : "create",
            model_id: selected.id,
            model_status: selected.status,
            model_execution_status: guideModelExecutionStatus(selected),
            modality: selected.modality ?? null,
            suggested_aspect_ratio: selectedAspectRatio,
            reason:
              requestedModelId === null
                ? createGuideSelectionReason(
                    selected,
                    trimmedPrompt,
                    requestedIntent,
                    guideOperation,
                  )
                : createGuideSelectedModelRequiresInputImage(selected)
                  ? selected.modality === "3d"
                    ? "requested executable image-to-3D model"
                    : "requested executable input-image edit model"
                  : "requested executable create model",
          },
    cost: {
      estimated_credits: estimatedCredits,
      estimated_usd_per_image: estimatedDebitUsdPerImage,
      estimated_debit_usd_per_image: estimatedDebitUsdPerImage,
      estimated_provider_usd_per_image: estimatedProviderUsdPerImage,
      credit_unit_usd: pricing?.credit_unit_usd ?? CREDIT_UNIT_USD,
      pricing_confidence: pricing?.pricing_confidence ?? null,
      pricing_source: pricing?.pricing_source ?? null,
      model_parameter_defaults_applied:
        defaultedModelParameters.defaultsApplied,
    },
    blocker,
    guide_warning: guideWarning,
    auth_ready: authReady,
    next_command: nextCommand,
    next_command_copy_runnable: nextCommandCopyRunnable,
    next_command_missing_inputs: nextCommandMissingInputs,
    next_command_effect: nextCommandEffect,
    no_spend_next_command: noSpendNextCommand,
    no_spend_next_command_label: noSpendNextCommandLabel,
    no_spend_next_command_effect: noSpendNextCommandEffect,
    no_spend_evaluation: noSpendEvaluation,
    guide_recovery: guideRecovery,
    recommended_no_spend_command: noSpendNextCommand,
    recommended_no_spend_command_label: noSpendNextCommandLabel,
    recommended_no_spend_command_effect: noSpendNextCommandEffect,
    self_fund_next_command: selfFundNextCommand,
    self_fund_next_command_label: selfFundNextCommandLabel,
    self_fund_handoff: selfFundHandoff,
    self_fund_preparation: selfFundPreparation,
    after_next: afterNext,
    auth_handoff: authHandoff,
    escape_hatches: escapeHatches,
    mutation: {
      provider_call: false,
      hosted_create: false,
      hosted_signup: false,
      payment_object: false,
      credit_debit: false,
      media_write: false,
    },
  });
}

function createGuideSuccess(command, actor, data) {
  const result = success(command, data);
  result.envelope.actor = actor;
  return result;
}

function selectCreateGuideModel(
  models,
  requestedModelId,
  {
    operation = "create",
    prompt = "",
    intent = undefined,
    maxEstimatedUsdPerImage = null,
  } = {},
) {
  const isExecutableCreate = (model) =>
    model?.status === "available" &&
    guideModelExecutionStatus(model) === "executable" &&
    Array.isArray(model?.supports) &&
    model.supports.includes("create");
  const isExecutableInputImageEdit = (model) =>
    model?.status === "available" &&
    guideModelExecutionStatus(model) === "executable" &&
    Array.isArray(model?.supports) &&
    (model.supports.includes("edit") || model.supports.includes("variation")) &&
    createGuideSelectedModelRequiresInputImage(model);
  const isExecutableGuideModel = (model) =>
    operation === "edit"
      ? isExecutableInputImageEdit(model)
      : isExecutableCreate(model) || isExecutableInputImageEdit(model);
  if (requestedModelId !== null) {
    const requested = resolveModelLookup(requestedModelId, models);
    return requested !== undefined && isExecutableGuideModel(requested)
      ? requested
      : null;
  }
  const candidates =
    operation === "edit"
      ? models.filter(isExecutableInputImageEdit)
      : models.filter(isExecutableCreate);
  if (createGuideImplies3d({ prompt, intent })) {
    const eligible3d = guideCandidatesWithinBudget({
      candidates: models.filter(
        (model) =>
          model?.modality === "3d" && isExecutableInputImageEdit(model),
      ),
      maxEstimatedUsdPerImage,
    });
    const threeDimensional = eligible3d[0];
    if (threeDimensional !== undefined) {
      return threeDimensional;
    }
  }
  const eligible = guideCandidatesWithinBudget({
    candidates,
    maxEstimatedUsdPerImage,
  });
  if (createGuideImpliesAudio({ prompt, intent })) {
    const audio = eligible.find((model) => model?.modality === "audio");
    if (audio !== undefined) {
      return audio;
    }
  }
  if (createGuideImpliesVideo({ prompt, intent })) {
    const video = eligible.find((model) => model?.modality === "video");
    if (video !== undefined) {
      return video;
    }
  }
  const intentClass = createGuideIntentClass(intent);
  for (const modelId of preferredCreateGuideModelIds(intentClass)) {
    const preferred = eligible.find((model) => model?.id === modelId);
    if (preferred !== undefined) {
      return preferred;
    }
  }
  return eligible[0] ?? null;
}

const MODEL_ALIAS_RULES = [
  {
    alias: "nano-banana",
    modelId: "fal.nano-banana-2",
    synonyms: [
      "nano banana",
      "fal/nano-banana",
      "fal-ai/nano-banana",
      "fal-ai/nano-banana-2",
    ],
  },
  {
    alias: "nano-banana-edit",
    modelId: "fal.nano-banana-2-edit",
    synonyms: [
      "nano banana edit",
      "nano-banana-2/edit",
      "fal/nano-banana/edit",
      "fal-ai/nano-banana/edit",
      "fal-ai/nano-banana-2/edit",
    ],
  },
  {
    alias: "nano-banana-pro",
    modelId: "fal.nano-banana-pro",
    synonyms: ["nano banana pro", "fal-ai/nano-banana-pro"],
  },
  {
    alias: "nano-banana-pro-edit",
    modelId: "fal.nano-banana-pro-edit",
    synonyms: [
      "nano banana pro edit",
      "nano-banana-pro/edit",
      "fal-ai/nano-banana-pro/edit",
    ],
  },
  {
    alias: "imagen4",
    modelId: "fal.imagen4-preview",
    synonyms: ["imagen 4", "fal-ai/imagen4/preview"],
  },
  {
    alias: "imagen4-fast",
    modelId: "fal.imagen4-preview-fast",
    synonyms: ["imagen 4 fast", "fal-ai/imagen4/preview/fast"],
  },
  {
    alias: "imagen4-ultra",
    modelId: "fal.imagen4-preview-ultra",
    synonyms: ["imagen 4 ultra", "fal-ai/imagen4/preview/ultra"],
  },
];

function resolveModelLookup(requestedModelId, models) {
  const requested = String(requestedModelId ?? "").trim();
  if (requested.length === 0) {
    return undefined;
  }
  if (requested === "default") {
    return models.find((model) => model?.default === true);
  }
  const exact = models.find((model) => model?.id === requested);
  if (exact !== undefined) {
    return exact;
  }
  const normalized = normalizeModelLookupToken(requested);
  const alias = MODEL_ALIAS_RULES.find((rule) =>
    [rule.alias, ...rule.synonyms].some(
      (candidate) => normalizeModelLookupToken(candidate) === normalized,
    ),
  );
  if (alias !== undefined) {
    const model = models.find((candidate) => candidate?.id === alias.modelId);
    if (model !== undefined) {
      return model;
    }
  }
  const normalizedMatches = models.filter(
    (model) => normalizeModelLookupToken(model?.id ?? "") === normalized,
  );
  if (normalizedMatches.length === 1) {
    return normalizedMatches[0];
  }
  const fuzzyMatches = models.filter((model) =>
    modelMatchesLookupQuery(model, requested),
  );
  return fuzzyMatches.length === 1 ? fuzzyMatches[0] : undefined;
}

function modelMatchesLookupQuery(model, query) {
  const normalizedQuery = normalizeModelLookupToken(query);
  if (normalizedQuery.length === 0) {
    return true;
  }
  const aliases = MODEL_ALIAS_RULES.filter(
    (rule) => rule.modelId === model?.id,
  ).flatMap((rule) => [rule.alias, ...rule.synonyms]);
  const searchable = [
    model?.id,
    model?.display_name,
    model?.provider_id,
    model?.modality,
    ...(Array.isArray(model?.supports) ? model.supports : []),
    ...(Array.isArray(model?.operations) ? model.operations : []),
    ...(Array.isArray(model?.task_tags) ? model.task_tags : []),
    ...aliases,
  ]
    .filter((value) => typeof value === "string")
    .map(normalizeModelLookupToken)
    .join(" ");
  if (searchable.includes(normalizedQuery)) {
    return true;
  }
  const queryTokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 0);
  return (
    queryTokens.length > 0 &&
    queryTokens.every((token) =>
      searchable.includes(normalizeModelLookupToken(token)),
    )
  );
}

function normalizeModelLookupToken(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "");
}

function guideCandidatesWithinBudget({
  candidates,
  maxEstimatedUsdPerImage = null,
}) {
  if (maxEstimatedUsdPerImage === null) {
    return candidates;
  }
  const capped = candidates.filter((model) => {
    const estimatedUsd = guideBudgetUsdForModel(model);
    return estimatedUsd === null || estimatedUsd <= maxEstimatedUsdPerImage;
  });
  return capped.length === 0 ? candidates : capped;
}

function createGuideIntentClass(intent) {
  const normalized = String(intent ?? "")
    .trim()
    .toLowerCase();
  if (["cheap", "budget", "draft", "test"].includes(normalized)) {
    return "budget_draft";
  }
  if (
    [
      "final",
      "finalize",
      "hero",
      "product",
      "product-shot",
      "campaign",
      "publication",
      "deliverable",
    ].includes(normalized)
  ) {
    return "final";
  }
  return "general";
}

function preferredCreateGuideModelIds(intentClass) {
  return intentClass === "budget_draft"
    ? [
        "fal.flux-dev",
        "xai.grok-imagine-image-quality",
        "xai.grok-imagine-image",
        "openai.gpt-image-2",
      ]
    : [
        "xai.grok-imagine-image-quality",
        "fal.flux-dev",
        "xai.grok-imagine-image",
        "openai.gpt-image-2",
      ];
}

function guideBudgetUsdForModel(model) {
  const pricing = createGuideModelCreditPricing(model);
  return (
    pricing?.estimated_revenue_usd ??
    model?.economics?.estimated_usd_per_image ??
    pricing?.estimated_provider_cost_usd ??
    pricing?.fallback_provider_cost_usd ??
    (typeof model?.estimated_usd_per_image === "number"
      ? model.estimated_usd_per_image
      : null) ??
    null
  );
}

function createGuideDefaultModelParameters(input) {
  const modelParameters = { ...(input.modelParameters ?? {}) };
  const defaultsApplied = [];

  if (
    input.model?.id === "xai.grok-imagine-image-quality" &&
    modelParameters.resolution === undefined
  ) {
    const twoKEstimate = createGuideProviderCostEstimateForModel(
      input.model,
      { resolution: "2k" },
      { aspectRatio: input.aspectRatio },
    ).estimated_provider_cost_usd;
    const twoKAllowedByBudget =
      input.maxEstimatedUsdPerImage === null ||
      twoKEstimate === null ||
      twoKEstimate <= input.maxEstimatedUsdPerImage;
    const intentClass = createGuideIntentClass(input.intent);
    const resolution =
      intentClass !== "budget_draft" && twoKAllowedByBudget ? "2k" : "1k";
    modelParameters.resolution = resolution;
    defaultsApplied.push(`resolution=${resolution}`);
  }

  if (
    input.model?.id === "fal.flux-dev" &&
    modelParameters.image_size === undefined
  ) {
    const imageSize = falDefaultImageSize(input.aspectRatio);
    if (imageSize !== null) {
      modelParameters.image_size = imageSize;
      defaultsApplied.push(`image_size=${imageSize}`);
    }
  }

  if (
    input.model?.id === "openai.gpt-image-2" &&
    modelParameters.quality === undefined
  ) {
    const mediumEstimate = createGuideProviderCostEstimateForModel(
      input.model,
      { ...modelParameters, quality: "medium" },
      { aspectRatio: input.aspectRatio },
    ).estimated_provider_cost_usd;
    const mediumAllowedByBudget =
      input.maxEstimatedUsdPerImage === null ||
      mediumEstimate === null ||
      mediumEstimate <= input.maxEstimatedUsdPerImage;
    if (mediumAllowedByBudget) {
      modelParameters.quality = "medium";
      defaultsApplied.push("quality=medium");
    }
  }

  return { modelParameters, defaultsApplied };
}

function createGuidePricingForModel(model, modelParameters, context = {}) {
  const estimate = createGuideProviderCostEstimateForModel(
    model,
    modelParameters,
    context,
  );
  if (estimate.estimated_provider_cost_usd === null) {
    return createGuideModelCreditPricing(model);
  }
  return createGuideCreditPricingForProviderCost({
    providerCostUsd: estimate.estimated_provider_cost_usd,
    pricingConfidence: estimate.pricing_confidence,
    pricingSource: estimate.pricing_source,
  });
}

function createGuideCanPriceModelParameters(model) {
  return String(model?.id ?? "").startsWith("xai.grok-imagine-image");
}

function createGuideProviderCostEstimateForModel(
  model,
  modelParameters = {},
  context = {},
) {
  if (String(model?.id ?? "").startsWith("xai.grok-imagine-image")) {
    return createGuideXaiImageCostEstimate(model, modelParameters, context);
  }
  return {
    estimated_provider_cost_usd:
      typeof model?.economics?.estimated_usd_per_image === "number"
        ? model.economics.estimated_usd_per_image
        : (createGuideModelCreditPricing(model)?.estimated_provider_cost_usd ??
          null),
    pricing_source: "model_registry",
    pricing_confidence: "known",
  };
}

function createGuideXaiImageCostEstimate(model, modelParameters, context) {
  const modelId = String(model?.id ?? "");
  const quality = modelId.includes("-quality");
  const edit = modelId.endsWith("-edit");
  const resolution = modelParameters?.resolution === "2k" ? "2k" : "1k";
  const outputImageCount =
    Number.isInteger(context?.outputCount) && context.outputCount > 0
      ? context.outputCount
      : 1;
  const referenceAssetCount =
    Number.isInteger(context?.referenceAssetCount) &&
    context.referenceAssetCount > 0
      ? context.referenceAssetCount
      : 0;
  const sourceImageCount = edit ? 1 + referenceAssetCount : 0;
  const inputUsdPerImage = quality ? 0.01 : 0.002;
  const outputUsdPerImage =
    quality && resolution === "2k" ? 0.07 : quality ? 0.05 : 0.02;
  const defaultResolution =
    modelParameters?.resolution === undefined ||
    modelParameters?.resolution === null ||
    modelParameters?.resolution === "1k";
  const defaultShape =
    defaultResolution &&
    outputImageCount === 1 &&
    sourceImageCount === (edit ? 1 : 0);
  return {
    estimated_provider_cost_usd: roundUsdMicro(
      inputUsdPerImage * sourceImageCount +
        outputUsdPerImage * outputImageCount,
    ),
    pricing_source: defaultShape ? "model_registry" : "model_parameters",
    pricing_confidence: "known",
  };
}

function createGuideCreditPricingForProviderCost(input) {
  const providerCostUsd = roundUsdMicro(input.providerCostUsd);
  const creditsRequired = Math.max(
    1,
    Math.ceil(
      roundUsdMicro(
        providerCostUsd / (1 - TARGET_GROSS_MARGIN) / CREDIT_UNIT_USD,
      ),
    ),
  );
  const estimatedRevenueUsd = roundUsd(creditsRequired * CREDIT_UNIT_USD);
  const estimatedPaymentFeeUsd = roundUsdMicro(
    estimatedRevenueUsd * PAYMENT_BACKED_CREDIT_PAYMENT_FEE_RATE,
  );
  const estimatedNetRevenueUsd = roundUsdMicro(
    estimatedRevenueUsd - estimatedPaymentFeeUsd,
  );
  const estimatedGrossMargin =
    estimatedRevenueUsd > 0
      ? roundRatio(
          (estimatedRevenueUsd - providerCostUsd) / estimatedRevenueUsd,
        )
      : null;
  const estimatedFeeAdjustedMargin =
    estimatedRevenueUsd > 0
      ? roundRatio(
          (estimatedNetRevenueUsd - providerCostUsd) / estimatedRevenueUsd,
        )
      : null;
  const selfFundBlockReason =
    estimatedNetRevenueUsd + 1e-9 < providerCostUsd
      ? "payment_fee_margin_negative"
      : null;
  return {
    credits_required: creditsRequired,
    credit_unit_usd: CREDIT_UNIT_USD,
    estimated_provider_cost_usd: providerCostUsd,
    fallback_provider_cost_usd: null,
    estimated_revenue_usd: estimatedRevenueUsd,
    estimated_gross_margin: estimatedGrossMargin,
    payment_fee_rate: PAYMENT_BACKED_CREDIT_PAYMENT_FEE_RATE,
    payment_fee_model: PAYMENT_BACKED_CREDIT_PAYMENT_FEE_MODEL,
    estimated_payment_fee_usd: estimatedPaymentFeeUsd,
    estimated_net_revenue_usd: estimatedNetRevenueUsd,
    estimated_fee_adjusted_margin: estimatedFeeAdjustedMargin,
    self_fundable: selfFundBlockReason === null,
    self_fund_block_reason: selfFundBlockReason,
    target_gross_margin: TARGET_GROSS_MARGIN,
    pricing_confidence: input.pricingConfidence,
    pricing_source: input.pricingSource,
    margin_model: "provider_cost_plus_margin",
  };
}

function falDefaultImageSize(aspectRatio) {
  switch (aspectRatio) {
    case "1:1":
      return "square_hd";
    case "4:3":
      return "landscape_4_3";
    case "3:4":
      return "portrait_4_3";
    case "16:9":
      return "landscape_16_9";
    case "9:16":
      return "portrait_16_9";
    default:
      return null;
  }
}

function roundUsd(value) {
  return Math.round(value * 100) / 100;
}

function roundRatio(value) {
  return Math.round(value * 1000) / 1000;
}

function roundUsdMicro(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function guideModelExecutionStatus(model) {
  if (
    isRecord(model?.execution) &&
    typeof model.execution.model_execution_status === "string"
  ) {
    return model.execution.model_execution_status;
  }
  return typeof model?.model_execution_status === "string"
    ? model.model_execution_status
    : null;
}

function createGuideModelCreditPricing(model) {
  if (isRecord(model?.economics?.credit_pricing)) {
    return model.economics.credit_pricing;
  }
  if (typeof model?.credits_required !== "number") {
    return null;
  }
  return {
    credits_required: model.credits_required,
    estimated_revenue_usd:
      typeof model.credits_required === "number"
        ? model.credits_required * CREDIT_UNIT_USD
        : null,
    estimated_provider_cost_usd:
      typeof model?.estimated_usd_per_image === "number"
        ? model.estimated_usd_per_image
        : null,
    fallback_provider_cost_usd: null,
    credit_unit_usd: CREDIT_UNIT_USD,
    pricing_confidence:
      typeof model?.pricing_confidence === "string"
        ? model.pricing_confidence
        : null,
  };
}

function createGuideImplies3d(input) {
  const searchable =
    `${input?.intent ?? ""} ${input?.prompt ?? ""}`.toLowerCase();
  return /\b(?:glb|gltf|mesh|model\s+asset|asset\s+model|textured\s+model|image-to-3d|(?:3d|three-d)\s+(?:\w+\s+){0,3}(?:model|asset|mesh|object)|(?:model|asset|mesh|object)\s+(?:in|as)\s+(?:3d|three-d))\b/.test(
    searchable,
  );
}

function createGuideImpliesAudio(input) {
  const searchable =
    `${input?.intent ?? ""} ${input?.prompt ?? ""}`.toLowerCase();
  if (/\bmusic\s+video\b/.test(searchable)) {
    return false;
  }
  return /\b(?:audio|sound|music|soundtrack|wav|text-to-audio)\b/.test(
    searchable,
  );
}

function createGuideImpliesVideo(input) {
  const searchable =
    `${input?.intent ?? ""} ${input?.prompt ?? ""}`.toLowerCase();
  return /\b(?:video|clip|footage|animation|animated|mp4|b-roll|timelapse|time-lapse)\b/.test(
    searchable,
  );
}

function createGuideSuggestedAspectRatio(model) {
  if (model?.modality !== "video") {
    return null;
  }
  const values = Array.isArray(model?.media?.input?.aspect_ratios?.values)
    ? model.media.input.aspect_ratios.values
    : model?.aspect_ratios;
  if (!Array.isArray(values)) {
    return null;
  }
  return values.includes("16:9") ? "16:9" : (values[0] ?? null);
}

function createGuideSelectedModelRequiresInputImage(model) {
  return (
    (model?.media?.input?.images?.required === true ||
      model?.accepts_input_images === true) &&
    Array.isArray(model?.supports) &&
    (model.supports.includes("edit") || model.supports.includes("variation"))
  );
}

function createGuideSelectionReason(
  model,
  prompt,
  intent,
  operation = "create",
) {
  if (
    createGuideSelectedModelRequiresInputImage(model) &&
    createGuideImplies3d({ prompt, intent })
  ) {
    return "3D intent matched executable image-to-3D model; provide one Image Skill-owned image_... input asset";
  }
  if (
    model?.modality === "audio" &&
    createGuideImpliesAudio({ prompt, intent })
  ) {
    return "audio intent matched executable audio create model";
  }
  if (
    model?.modality === "video" &&
    createGuideImpliesVideo({ prompt, intent })
  ) {
    return "video intent matched executable video create model";
  }
  if (
    preferredCreateGuideModelIds(createGuideIntentClass(intent)).includes(
      model?.id,
    )
  ) {
    return createGuideIntentClass(intent) === "budget_draft"
      ? "guide selected a draft/budget create model with high-definition defaults"
      : "guide selected the strongest currently available quality-first create model for this intent";
  }
  return operation === "edit"
    ? "guide selected the first available executable input-image edit model"
    : "guide selected the first available executable create model";
}

function createGuidePaymentSummary(data, commandPrefix) {
  const methods = Array.isArray(data?.methods)
    ? data.methods.filter((method) => method.live_money)
    : [];
  const availableMethods = methods.filter((method) => method.available);
  const browserlessMethods = availableMethods.filter(
    (method) => method.requires_browser === false,
  );
  const agentPayableMethods = browserlessMethods.filter(
    (method) =>
      method.agent_settleable === true &&
      (method.buyer_modes ?? []).some(
        (mode) => mode === "agent_only" || mode === "hybrid",
      ),
  );
  const agentInitiatedMethods = availableMethods.filter(
    (method) => method.agent_initiated === true,
  );
  const humanHandoffMethods = availableMethods.filter(
    (method) =>
      method.requires_browser === true ||
      (method.buyer_modes ?? []).some((mode) => mode === "human_only"),
  );
  const preferredMethod =
    agentPayableMethods[0] ??
    humanHandoffMethods[0] ??
    browserlessMethods[0] ??
    availableMethods[0];
  return {
    checked: data !== null && typeof data === "object",
    live_money_methods: availableMethods.map((method) => method.method_id),
    requires_browser:
      availableMethods.length > 0 &&
      availableMethods.every((method) => method.requires_browser === true),
    browserless_methods: browserlessMethods.map((method) => method.method_id),
    agent_initiated_methods: agentInitiatedMethods.map(
      (method) => method.method_id,
    ),
    agent_payable_methods: agentPayableMethods.map(
      (method) => method.method_id,
    ),
    agent_settleable_methods: agentPayableMethods.map(
      (method) => method.method_id,
    ),
    human_handoff_methods: humanHandoffMethods.map(
      (method) => method.method_id,
    ),
    preferred_method: preferredMethod?.method_id ?? null,
    preferred_method_summary:
      preferredMethod === undefined
        ? null
        : createGuidePreferredPaymentSummary(preferredMethod),
    buyer_modes: [
      ...new Set(methods.flatMap((method) => method.buyer_modes ?? [])),
    ],
    suggested_commands: createGuidePaymentCommands(
      preferredMethod,
      availableMethods.filter((method) => method !== preferredMethod),
      commandPrefix,
    ),
  };
}

function createGuidePreferredPaymentSummary(method) {
  const buyerModes = Array.isArray(method.buyer_modes)
    ? method.buyer_modes.filter((mode) => typeof mode === "string")
    : [];
  const liveMoney = method.live_money !== false;
  const browserless = method.requires_browser === false;
  const requiresBrowser = method.requires_browser === true;
  const agentInitiated = method.agent_initiated === true;
  const agentSettleable = method.agent_settleable === true;
  const humanHandoffRequired =
    requiresBrowser || buyerModes.includes("human_only");
  const topUpPath =
    agentSettleable && browserless
      ? "browserless_agent_self_fund"
      : humanHandoffRequired
        ? "human_payment_handoff"
        : "payment_method_inspection";
  return {
    method_id: method.method_id,
    live_money: liveMoney,
    requires_browser: requiresBrowser,
    browserless,
    agent_initiated: agentInitiated,
    agent_settleable: agentSettleable,
    human_handoff_required: humanHandoffRequired,
    buyer_modes: buyerModes,
    settlement_blocker:
      typeof method.settlement_blocker === "string"
        ? method.settlement_blocker
        : null,
    default_pack_id:
      typeof method.default_pack_id === "string"
        ? method.default_pack_id
        : null,
    min_amount_cents:
      typeof method.limits?.min_amount_cents === "number"
        ? method.limits.min_amount_cents
        : null,
    max_amount_cents:
      typeof method.limits?.max_amount_cents === "number"
        ? method.limits.max_amount_cents
        : null,
    top_up_path: topUpPath,
    next_step:
      topUpPath === "browserless_agent_self_fund"
        ? "quote_buy_status_then_rerun_after_next"
        : topUpPath === "human_payment_handoff"
          ? "quote_buy_open_checkout_status_then_rerun_after_next"
          : "inspect_credits_methods",
    warning:
      topUpPath === "browserless_agent_self_fund"
        ? "Preferred rail is browserless live money that a wallet-equipped agent can initiate and settle inside delegated caps."
        : topUpPath === "human_payment_handoff"
          ? "Preferred rail starts a live-money payment handoff and requires human or browser completion before credits are granted."
          : "Preferred payment rail needs inspection before an agent can choose the next top-up action.",
  };
}

function createGuidePaymentCommands(
  preferredMethod,
  fallbackMethods,
  commandPrefix,
) {
  const commands = [
    "image-skill credits methods --json",
    "image-skill credits packs list --json",
    preferredMethod?.recovery?.quote_command ??
      "image-skill credits quote --pack starter-500 --payment-method stripe_x402.exact.usdc --json",
    preferredMethod?.recovery?.purchase_command ??
      "image-skill credits buy --provider stripe_x402 --quote-id QUOTE_ID --idempotency-key KEY --json",
    preferredMethod?.recovery?.status_command ??
      "image-skill credits status --payment-attempt-id PAYMENT_ATTEMPT_ID --json",
  ];
  for (const method of fallbackMethods) {
    for (const command of [
      method.recovery?.quote_command,
      method.recovery?.purchase_command,
      method.recovery?.status_command,
    ]) {
      if (typeof command === "string" && !commands.includes(command)) {
        commands.push(command);
      }
    }
  }
  return commands.map((command) =>
    renderCopyRunnablePaymentCommand(commandPrefix, command),
  );
}

function withCopyRunnablePaymentMethodCommands(result, commandPrefix) {
  const data = result.envelope.data;
  if (data === null || typeof data !== "object") {
    return result;
  }
  return {
    ...result,
    envelope: {
      ...result.envelope,
      data: paymentMethodCatalogWithCopyRunnableCommands(data, commandPrefix),
    },
  };
}

function paymentMethodCatalogWithCopyRunnableCommands(catalog, commandPrefix) {
  const nextActions =
    catalog.next_actions !== null && typeof catalog.next_actions === "object"
      ? catalog.next_actions
      : null;
  const recommendedQuote =
    nextActions?.recommended_quote !== null &&
    typeof nextActions?.recommended_quote === "object"
      ? nextActions.recommended_quote
      : null;
  return {
    ...catalog,
    ...(recommendedQuote === null
      ? {}
      : {
          next_actions: {
            ...nextActions,
            recommended_quote: {
              ...recommendedQuote,
              command:
                typeof recommendedQuote.command === "string"
                  ? renderCopyRunnablePaymentCommand(
                      commandPrefix,
                      recommendedQuote.command,
                    )
                  : recommendedQuote.command,
              quote_command:
                typeof recommendedQuote.quote_command === "string"
                  ? renderCopyRunnablePaymentCommand(
                      commandPrefix,
                      recommendedQuote.quote_command,
                    )
                  : recommendedQuote.quote_command,
              buy_command:
                typeof recommendedQuote.buy_command === "string"
                  ? renderCopyRunnablePaymentCommand(
                      commandPrefix,
                      recommendedQuote.buy_command,
                    )
                  : recommendedQuote.buy_command,
              status_command:
                typeof recommendedQuote.status_command === "string"
                  ? renderCopyRunnablePaymentCommand(
                      commandPrefix,
                      recommendedQuote.status_command,
                    )
                  : recommendedQuote.status_command,
            },
          },
        }),
    methods: Array.isArray(catalog.methods)
      ? catalog.methods.map((method) => ({
          ...method,
          recovery:
            method.recovery === null || typeof method.recovery !== "object"
              ? method.recovery
              : {
                  ...method.recovery,
                  quote_command:
                    typeof method.recovery.quote_command === "string"
                      ? renderCopyRunnablePaymentCommand(
                          commandPrefix,
                          method.recovery.quote_command,
                        )
                      : method.recovery.quote_command,
                  purchase_command:
                    typeof method.recovery.purchase_command === "string"
                      ? renderCopyRunnablePaymentCommand(
                          commandPrefix,
                          method.recovery.purchase_command,
                        )
                      : method.recovery.purchase_command,
                  status_command:
                    typeof method.recovery.status_command === "string"
                      ? renderCopyRunnablePaymentCommand(
                          commandPrefix,
                          method.recovery.status_command,
                        )
                      : method.recovery.status_command,
                },
        }))
      : catalog.methods,
  };
}

function withCopyRunnableCreditQuoteCommands(result, commandPrefix) {
  const data = result.envelope.data;
  if (
    data === null ||
    typeof data !== "object" ||
    data.next_actions === null ||
    typeof data.next_actions !== "object"
  ) {
    return result;
  }
  return {
    ...result,
    envelope: {
      ...result.envelope,
      data: creditQuoteWithCopyRunnableCommands(data, commandPrefix),
    },
  };
}

function withCopyRunnablePaymentNextActionCommands(result, commandPrefix) {
  const data = result.envelope.data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return result;
  }
  const updated = paymentNextActionsWithCopyRunnableCommands(
    data,
    commandPrefix,
  );
  if (updated === data) {
    return result;
  }
  return {
    ...result,
    envelope: {
      ...result.envelope,
      data: updated,
    },
  };
}

function paymentNextActionsWithCopyRunnableCommands(data, commandPrefix) {
  let changed = false;
  let updated = data;

  if (
    data.quota !== null &&
    typeof data.quota === "object" &&
    !Array.isArray(data.quota) &&
    data.quota.top_up !== null &&
    typeof data.quota.top_up === "object" &&
    !Array.isArray(data.quota.top_up)
  ) {
    updated = {
      ...updated,
      quota: {
        ...data.quota,
        top_up: quotaTopUpWithCopyRunnableCommands(
          data.quota.top_up,
          commandPrefix,
        ),
      },
    };
    changed = true;
  }

  if (typeof data.self_fund_next_command === "string") {
    const rendered = renderCopyRunnablePaymentCommand(
      commandPrefix,
      data.self_fund_next_command,
    );
    if (rendered !== data.self_fund_next_command) {
      updated = {
        ...updated,
        self_fund_next_command: rendered,
      };
      changed = true;
    }
  }

  if (
    data.next_actions === null ||
    typeof data.next_actions !== "object" ||
    Array.isArray(data.next_actions)
  ) {
    return changed ? updated : data;
  }

  const nextActions = { ...data.next_actions };

  if (
    nextActions.recommended_buy !== null &&
    typeof nextActions.recommended_buy === "object" &&
    !Array.isArray(nextActions.recommended_buy)
  ) {
    const recommendedBuy = { ...nextActions.recommended_buy };
    changed =
      renderPaymentActionCommandField(
        recommendedBuy,
        "command",
        commandPrefix,
      ) || changed;
    changed =
      renderPaymentActionCommandField(
        recommendedBuy,
        "buy_command",
        commandPrefix,
      ) || changed;
    changed =
      renderPaymentActionCommandField(
        recommendedBuy,
        "status_command",
        commandPrefix,
      ) || changed;
    changed =
      renderPaymentActionCommandField(
        recommendedBuy,
        "status_command_after_payment",
        commandPrefix,
      ) || changed;
    nextActions.recommended_buy = recommendedBuy;
  }

  if (
    nextActions.recommended_settlement !== null &&
    typeof nextActions.recommended_settlement === "object" &&
    !Array.isArray(nextActions.recommended_settlement)
  ) {
    const recommendedSettlement = { ...nextActions.recommended_settlement };
    changed =
      renderPaymentActionCommandField(
        recommendedSettlement,
        "status_command",
        commandPrefix,
      ) || changed;
    changed =
      renderPaymentActionCommandField(
        recommendedSettlement,
        "quota_command",
        commandPrefix,
      ) || changed;
    nextActions.recommended_settlement = recommendedSettlement;
  }

  if (
    nextActions.self_fund !== null &&
    typeof nextActions.self_fund === "object" &&
    !Array.isArray(nextActions.self_fund)
  ) {
    const selfFund = { ...nextActions.self_fund };
    changed =
      renderSelfFundActionCommandFields(selfFund, commandPrefix) || changed;
    nextActions.self_fund = selfFund;
  }

  return changed ? { ...updated, next_actions: nextActions } : data;
}

function renderPaymentActionCommandField(record, field, commandPrefix) {
  if (typeof record[field] !== "string") {
    return false;
  }
  const rendered = renderCopyRunnablePaymentCommand(
    commandPrefix,
    record[field],
  );
  if (rendered === record[field]) {
    return false;
  }
  record[field] = rendered;
  return true;
}

function renderSelfFundActionCommandFields(record, commandPrefix) {
  let changed = false;
  for (const field of [
    "first_safe_command",
    "inspect_methods_command",
    "inspect_packs_command",
    "quote_command",
    "buy_command",
    "status_command",
    "fallback_quote_command",
    "fallback_buy_command",
  ]) {
    changed =
      renderPaymentActionCommandField(record, field, commandPrefix) || changed;
  }

  if (
    record.workflow !== null &&
    typeof record.workflow === "object" &&
    !Array.isArray(record.workflow) &&
    Array.isArray(record.workflow.steps)
  ) {
    let workflowChanged = false;
    const steps = record.workflow.steps.map((step) => {
      if (
        step === null ||
        typeof step !== "object" ||
        Array.isArray(step) ||
        typeof step.command !== "string"
      ) {
        return step;
      }
      const command = renderCopyRunnablePaymentCommand(
        commandPrefix,
        step.command,
      );
      if (command === step.command) {
        return step;
      }
      workflowChanged = true;
      return { ...step, command };
    });
    if (workflowChanged) {
      record.workflow = { ...record.workflow, steps };
      changed = true;
    }
  }

  return changed;
}

function creditQuoteWithCopyRunnableCommands(quote, commandPrefix) {
  const recommendedBuy =
    quote.next_actions?.recommended_buy !== null &&
    typeof quote.next_actions?.recommended_buy === "object"
      ? quote.next_actions.recommended_buy
      : null;
  if (recommendedBuy === null) {
    return quote;
  }
  return {
    ...quote,
    next_actions: {
      ...quote.next_actions,
      recommended_buy: {
        ...recommendedBuy,
        command:
          typeof recommendedBuy.command === "string"
            ? renderCopyRunnablePaymentCommand(
                commandPrefix,
                recommendedBuy.command,
              )
            : recommendedBuy.command,
        buy_command:
          typeof recommendedBuy.buy_command === "string"
            ? renderCopyRunnablePaymentCommand(
                commandPrefix,
                recommendedBuy.buy_command,
              )
            : recommendedBuy.buy_command,
        status_command:
          typeof recommendedBuy.status_command === "string"
            ? renderCopyRunnablePaymentCommand(
                commandPrefix,
                recommendedBuy.status_command,
              )
            : recommendedBuy.status_command,
        status_command_after_payment:
          typeof recommendedBuy.status_command_after_payment === "string"
            ? renderCopyRunnablePaymentCommand(
                commandPrefix,
                recommendedBuy.status_command_after_payment,
              )
            : recommendedBuy.status_command_after_payment,
      },
    },
  };
}

function renderCopyRunnablePaymentCommand(commandPrefix, command) {
  if (/\bnpx\s+(?:-y|--yes)\s+image-skill@latest\b/.test(command)) {
    return command;
  }
  return renderGuidePrefixedCommand(commandPrefix, command);
}

function withCreditQuoteAuthRecovery(result, input) {
  const command = renderCopyRunnablePaymentCommand(
    createGuideCommandPrefix(),
    renderCreditQuoteRetryCommand(input),
  );
  return {
    ...result,
    envelope: {
      ...result.envelope,
      error: {
        ...result.envelope.error,
        recovery: {
          ...(result.envelope.error?.recovery ?? {}),
          after_auth: {
            command,
            command_copy_runnable: true,
            with_env: `IMAGE_SKILL_TOKEN="$IMAGE_SKILL_TOKEN" ${command}`,
            with_stdin: renderTokenStdinCommand(command),
            accepted_methods: ["config", "IMAGE_SKILL_TOKEN", "--token-stdin"],
            requires_auth: true,
            command_effect: {
              label: "live_money_quote_no_charge",
              live_money: true,
              payment_object: true,
              payment_attempt: false,
              wallet_settlement: false,
              provider_call: false,
              credit_debit: false,
              media_write: false,
            },
          },
        },
      },
    },
  };
}

function renderCreditQuoteRetryCommand(input) {
  return [
    "image-skill credits quote",
    ...(input.pack === null
      ? ["--credits", String(input.creditsValue)]
      : ["--pack", input.pack]),
    "--payment-method",
    input.paymentMethod,
    "--idempotency-key",
    input.idempotency.value,
    ...quoteRetryApiBaseArgs(input.args),
    "--json",
  ].join(" ");
}

function quoteRetryApiBaseArgs(args) {
  const apiBaseUrl = explicitApiBaseUrl(args);
  return apiBaseUrl === null ? [] : ["--api-base-url", shellQuote(apiBaseUrl)];
}

function createGuideStage(input) {
  if (input.promptRequired) {
    return "prompt_required";
  }
  if (!input.health.envelope.ok || !input.models.envelope.ok) {
    return "service_unreachable";
  }
  if (input.selected === null) {
    return "no_executable_model";
  }
  if (input.token.token === null) {
    return "auth_required";
  }
  if (input.quota === null || !input.quota.envelope.ok) {
    return input.quota?.envelope.error?.code === "AUTH_REQUIRED"
      ? "auth_required"
      : "service_unreachable";
  }
  const remaining = quotaRemainingCredits(input.quota.envelope.data);
  if (
    input.estimatedCredits !== null &&
    remaining !== null &&
    remaining < input.estimatedCredits
  ) {
    return "quota_required";
  }
  if (
    input.quota.envelope.data?.daily_jobs !== undefined &&
    input.quota.envelope.data.daily_jobs.remaining <= 0
  ) {
    return "quota_required";
  }
  return "ready_to_create";
}

function createGuideBlocker(stage, input) {
  if (stage === "ready_to_create") {
    return null;
  }
  if (stage === "prompt_required") {
    return {
      code: "prompt_required",
      message: "Add --prompt so the guide can return the exact create command.",
    };
  }
  if (stage === "no_executable_model") {
    return {
      code: "no_executable_model",
      message:
        input.requestedModelId === null
          ? "No available executable create model was found in the public registry."
          : `Requested model is not currently an available executable create model: ${input.requestedModelId}`,
    };
  }
  if (stage === "auth_required") {
    return {
      code: "auth_required",
      message:
        "Sign up once before creating hosted media; --agent-contact is optional and can be attached later.",
    };
  }
  if (stage === "quota_required") {
    const remaining = quotaRemainingCredits(input.quota?.envelope.data ?? null);
    return {
      code: "quota_required",
      message: `Selected first image requires ${input.estimatedCredits ?? "unknown"} credits; current remaining credits are ${remaining ?? "unknown"}.`,
    };
  }
  return {
    code: "service_unreachable",
    message:
      input.quota?.envelope.error?.message ??
      "Guide could not complete read-only hosted or registry checks.",
  };
}

function createGuideAuthHandoff(stage, input) {
  if (stage === "auth_required") {
    const authConfigWritable = input.authConfigWrite?.ok ?? true;
    const recovery =
      input.authConfigWrite?.ok === false
        ? configWriteRecovery("image-skill create --guide")
        : null;
    return {
      required: true,
      token_source: "none",
      secret_value_included: false,
      accepted_methods: ["IMAGE_SKILL_TOKEN", "--token-stdin", "config"],
      signup: {
        returns_token_once: true,
        public_cli_saves_config: true,
        store_token_in: authConfigWritable
          ? "public_cli_config_by_default"
          : "public_cli_config_after_setting_IMAGE_SKILL_CONFIG_PATH",
        config_path: configPath(),
        config_writable: authConfigWritable,
        preferred_save_config:
          recovery === null
            ? null
            : {
                config_path_env: recovery.config_path_env,
                config_path: recovery.suggested_config_path,
                command: input.nextCommand,
              },
        recovery,
      },
      rerun_guide:
        input.afterNext === null
          ? null
          : {
              with_env: `IMAGE_SKILL_TOKEN="$IMAGE_SKILL_TOKEN" ${input.afterNext}`,
              with_stdin: renderTokenStdinCommand(input.afterNext),
            },
      next_command: null,
    };
  }
  if (stage === "quota_required" || stage === "ready_to_create") {
    return {
      required: true,
      token_source: input.tokenSource,
      secret_value_included: false,
      accepted_methods: ["IMAGE_SKILL_TOKEN", "--token-stdin", "config"],
      signup: null,
      rerun_guide: null,
      next_command: {
        requires_auth: true,
        reuse_current_auth_context: input.tokenSource,
        with_env: `IMAGE_SKILL_TOKEN="$IMAGE_SKILL_TOKEN" ${input.nextCommand}`,
        with_stdin: renderTokenStdinCommand(input.nextCommand),
      },
    };
  }
  return null;
}

function createGuideAuthReady(stage, input) {
  const nextCommandRequiresAuth =
    stage === "quota_required" || stage === "ready_to_create";
  const ready = input.authenticated;
  return {
    ready,
    authenticated: input.authenticated,
    source: input.tokenSource,
    saved_config_path: input.savedConfigPath,
    next_command_requires_auth: nextCommandRequiresAuth,
    next_command_auth_ready: nextCommandRequiresAuth ? ready : null,
    secret_value_included: false,
    accepted_methods: ["config", "IMAGE_SKILL_TOKEN", "--token-stdin"],
    warning: ready
      ? "Current hosted auth is ready; data.next_command can reuse this auth context without exposing a raw token."
      : stage === "auth_required"
        ? input.nextCommandCopyRunnable
          ? "Auth is not ready yet; run data.next_command to create a restricted agent identity, then rerun the guide."
          : "Auth is not ready yet; fill data.next_command_missing_inputs before running the data.next_command signup template, then rerun the guide."
        : null,
  };
}

function createGuideSelfFundNextCommandLabel(
  stage,
  paymentSummary,
  selfFundPreparation,
) {
  if (stage === "ready_to_create") {
    if (createGuidePreWallSelfFundNextCommand(selfFundPreparation) === null) {
      return null;
    }
    if (
      selfFundPreparation?.top_up_path === "browserless_agent_self_fund" &&
      selfFundPreparation.preferred_method !== null &&
      paymentSummary.browserless_methods.includes(
        selfFundPreparation.preferred_method,
      ) &&
      paymentSummary.agent_settleable_methods.includes(
        selfFundPreparation.preferred_method,
      )
    ) {
      return "pre_wall_browserless_agent_payable_quote";
    }
    if (selfFundPreparation?.top_up_path === "human_payment_handoff") {
      return "pre_wall_human_handoff_payment_quote";
    }
    return "pre_wall_payment_or_quota_action";
  }
  if (stage !== "quota_required") {
    return null;
  }
  const preferredMethod = paymentSummary.preferred_method;
  if (
    preferredMethod !== null &&
    paymentSummary.browserless_methods.includes(preferredMethod) &&
    paymentSummary.agent_settleable_methods.includes(preferredMethod)
  ) {
    return "browserless_agent_payable_quote";
  }
  if (
    preferredMethod !== null &&
    paymentSummary.human_handoff_methods.includes(preferredMethod)
  ) {
    return "human_handoff_payment_quote";
  }
  return "payment_or_quota_action";
}

function createGuidePreWallSelfFundNextCommand(selfFundPreparation) {
  if (
    selfFundPreparation === null ||
    !selfFundPreparation.available ||
    !selfFundPreparation.recommended ||
    !selfFundPreparation.quote_command_copy_runnable
  ) {
    return null;
  }
  return selfFundPreparation.quote_command;
}

function createGuideSelfFundHandoff(stage, input) {
  if (stage !== "quota_required") {
    return null;
  }
  const preferredMethod = input.paymentSummary.preferred_method;
  const browserless =
    preferredMethod !== null &&
    input.paymentSummary.browserless_methods.includes(preferredMethod);
  const agentInitiated =
    preferredMethod !== null &&
    input.paymentSummary.agent_initiated_methods.includes(preferredMethod);
  const agentSettleable =
    preferredMethod !== null &&
    input.paymentSummary.agent_settleable_methods.includes(preferredMethod);
  const humanHandoffRequired =
    preferredMethod !== null &&
    input.paymentSummary.human_handoff_methods.includes(preferredMethod);
  const statusCommand = guidePaymentCommandByKind(
    input.paymentSummary.suggested_commands,
    "status",
  );
  const inspectMethodsCommand = guidePaymentInspectionCommand(
    input.paymentSummary.suggested_commands,
    "methods",
  );
  const inspectPacksCommand = guidePaymentInspectionCommand(
    input.paymentSummary.suggested_commands,
    "packs",
  );

  return {
    required: true,
    preferred_method: preferredMethod,
    ...createGuideQuotaTopUpUrgencyFields(input.quotaTopUp),
    live_money:
      preferredMethod !== null &&
      input.paymentSummary.live_money_methods.includes(preferredMethod),
    browserless,
    agent_initiated: agentInitiated,
    agent_settleable: agentSettleable,
    human_handoff_required: humanHandoffRequired,
    first_safe_command: inspectMethodsCommand,
    first_safe_command_effect: {
      label: "inspect_payment_methods_no_spend",
      no_spend: true,
      live_money: false,
      provider_call: false,
      hosted_create: false,
      payment_object: false,
      credit_debit: false,
      media_write: false,
    },
    inspect_methods_command: inspectMethodsCommand,
    inspect_packs_command: inspectPacksCommand,
    payment_commands: {
      quote: guidePaymentCommandByKind(
        input.paymentSummary.suggested_commands,
        "quote",
      ),
      buy: guidePaymentCommandByKind(
        input.paymentSummary.suggested_commands,
        "buy",
      ),
      status: statusCommand,
    },
    wallet_settlement: createGuideWalletSettlementHandoff({
      preferredMethod,
      browserless,
      agentSettleable,
      statusCommand,
    }),
    after_next: input.afterNext,
    auth: {
      token_source: input.tokenSource,
      secret_value_included: false,
      accepted_methods: ["IMAGE_SKILL_TOKEN", "--token-stdin", "config"],
      next_command: {
        requires_auth: true,
        reuse_current_auth_context: input.tokenSource,
        with_env: `IMAGE_SKILL_TOKEN="$IMAGE_SKILL_TOKEN" ${input.nextCommand}`,
        with_stdin: renderTokenStdinCommand(input.nextCommand),
      },
    },
    warning: agentSettleable
      ? "Start with data.self_fund_handoff.first_safe_command for no-spend inspection, then data.self_fund_next_command for the browserless live-money quote when delegated spend is allowed. Preserve auth with data.self_fund_handoff.auth.next_command, follow payment_commands.buy, pay exactly what wallet_settlement points to, run payment_commands.status, and rerun after_next."
      : "Start with data.self_fund_handoff.first_safe_command for no-spend inspection, then data.self_fund_next_command for the live-money payment handoff when delegated spend is allowed. Preserve auth with data.self_fund_handoff.auth.next_command, complete the payment, then rerun after_next.",
  };
}

function createGuideSelfFundPreparation(stage, input) {
  if (stage !== "ready_to_create") {
    return null;
  }
  const preferredMethod = input.paymentSummary.preferred_method;
  const preferredSummary = input.paymentSummary.preferred_method_summary;
  const quoteCommand = guidePaymentCommandByKind(
    input.paymentSummary.suggested_commands,
    "quote",
  );
  const available =
    preferredMethod !== null &&
    preferredSummary !== null &&
    quoteCommand !== null;
  const availableQuoteCommand = available ? quoteCommand : null;
  const topUpPath = preferredSummary?.top_up_path ?? null;
  const browserlessSelfFund = topUpPath === "browserless_agent_self_fund";
  return {
    available,
    recommended: input.quotaTopUp?.recommended === true,
    recommendation_reason: input.quotaTopUp?.recommendation_reason ?? null,
    ...createGuideQuotaTopUpUrgencyFields(input.quotaTopUp),
    preferred_method: preferredMethod,
    top_up_path: topUpPath,
    inspect_methods_command: guidePaymentInspectionCommand(
      input.paymentSummary.suggested_commands,
      "methods",
    ),
    inspect_packs_command: guidePaymentInspectionCommand(
      input.paymentSummary.suggested_commands,
      "packs",
    ),
    quote_command: availableQuoteCommand,
    quote_command_copy_runnable:
      availableQuoteCommand !== null &&
      createGuideNextCommandMissingInputs(availableQuoteCommand).length === 0,
    quote_command_effect: {
      label: "live_money_quote_no_charge",
      no_spend: true,
      live_money:
        preferredMethod !== null &&
        input.paymentSummary.live_money_methods.includes(preferredMethod),
      provider_call: false,
      hosted_create: false,
      payment_object: true,
      credit_debit: false,
      media_write: false,
      requires_wallet_for_buy: browserlessSelfFund,
      max_amount_cents: preferredSummary?.max_amount_cents ?? null,
      warning:
        "data.self_fund_preparation.quote_command creates an authenticated live-money quote but does not pay, debit credits, call a provider, or write media. Only a later credits buy/payment step can spend money.",
    },
    after_next: input.afterNext,
    auth: {
      quote_command_requires_auth: true,
      token_source: input.tokenSource,
      secret_value_included: false,
      accepted_methods: ["IMAGE_SKILL_TOKEN", "--token-stdin", "config"],
    },
    warning: browserlessSelfFund
      ? "You can inspect or quote the browserless self-fund rail before credits run out; do not run buy or transfer funds unless delegated spend is allowed."
      : "You can inspect the top-up path before credits run out; do not run buy or complete payment unless delegated spend is allowed.",
  };
}

function createGuideQuotaTopUp(topUp) {
  if (topUp === null) {
    return null;
  }
  return {
    ...topUp,
    ...quotaTopUpUrgencyFields(topUp),
  };
}

function createGuideQuotaTopUpUrgencyFields(quotaTopUp) {
  if (quotaTopUp === null) {
    return { urgency: null, urgency_score: null, urgency_reasons: [] };
  }
  return quotaTopUpUrgencyFields(quotaTopUp);
}

function createGuideWalletSettlementHandoff({
  preferredMethod,
  browserless,
  agentSettleable,
  statusCommand,
}) {
  if (
    preferredMethod !== "stripe_x402.exact.usdc" ||
    !browserless ||
    !agentSettleable
  ) {
    return null;
  }
  return {
    method_id: "stripe_x402.exact.usdc",
    wallet_required: true,
    browser_required: false,
    network: "base",
    token_currency: "usdc",
    exact_amount_required: true,
    secret_value_included: false,
    payable_instructions_fields: {
      buy_response: "data.stripe_x402.payable_instructions",
      status_response: "data.payment_attempt.stripe_x402.payable_instructions",
    },
    amount_atomic_field: "token_amount_atomic",
    destination_field: "deposit_address",
    status_command_after_payment: statusCommand,
    next_step:
      "Run payment_commands.buy, pay payable_instructions.token_amount_atomic USDC atomic units to payable_instructions.deposit_address on Base from a delegated wallet, then run status_command_after_payment until credits are granted before rerunning after_next.",
    credential_boundary:
      "Never send wallet private keys, seed phrases, x402 authorization payloads, Stripe secrets, client secrets, card data, provider receipts, or raw wallet credentials to Image Skill.",
    warning:
      "This is live money. Pay exactly the returned Base/USDC amount to the returned deposit address and stay within the delegated cap.",
  };
}

function createGuideNextCommandEffect(stage, input) {
  const placeholders = createGuideEffectPlaceholders(
    input.nextCommandMissingInputs,
  );
  const base = {
    label: "read_only_or_no_media_setup",
    no_spend: true,
    provider_call: false,
    hosted_create: false,
    hosted_signup: false,
    payment_object: false,
    credit_debit: false,
    media_write: false,
    estimated_credits: null,
    estimated_debit_usd_per_image: null,
    copy_runnable: input.nextCommandCopyRunnable,
    requires_placeholder_substitution: placeholders.length > 0,
    placeholders,
    warning: null,
  };
  if (stage === "auth_required") {
    return {
      ...base,
      label: "hosted_signup_restricted_agent_identity",
      hosted_signup: true,
      warning:
        "This signs up a restricted Image Skill agent identity but does not create media, call a provider, open payment, or debit credits.",
    };
  }
  if (stage === "quota_required") {
    return {
      ...base,
      label: "payment_or_quota_action",
      no_spend: false,
      payment_object: true,
      warning:
        "This may create or inspect a payment quote/attempt. Stay within the delegated cap, or use escape_hatches for read-only checks.",
    };
  }
  if (stage === "ready_to_create") {
    return {
      label: "live_media_create_credit_debit",
      no_spend: false,
      provider_call: true,
      hosted_create: true,
      hosted_signup: false,
      payment_object: false,
      credit_debit: true,
      media_write: true,
      estimated_credits: input.estimatedCredits,
      estimated_debit_usd_per_image: input.estimatedDebitUsdPerImage,
      copy_runnable: input.nextCommandCopyRunnable,
      requires_placeholder_substitution: placeholders.length > 0,
      placeholders,
      warning:
        "data.next_command creates hosted media and can debit credits. For no-spend verification, run data.recommended_no_spend_command (same value as data.no_spend_next_command) instead.",
    };
  }
  if (stage === "prompt_required") {
    return {
      ...base,
      label: "rerun_guide_with_prompt",
    };
  }
  return base;
}

function createGuideNoSpendNextCommandEffect(stage, input) {
  if (stage !== "ready_to_create") {
    return null;
  }
  return {
    label:
      "dry_run_planned_job_no_provider_call_no_credit_debit_no_media_write",
    no_spend: true,
    provider_call: false,
    hosted_create: false,
    hosted_create_dry_run: true,
    hosted_signup: false,
    payment_object: false,
    credit_debit: false,
    media_write: false,
    planned_job: true,
    plan_receipt: true,
    activity_event: "job.planned",
    estimated_credits: input.estimatedCredits,
    estimated_debit_usd_per_image: input.estimatedDebitUsdPerImage,
    warning:
      "data.no_spend_next_command may create a recoverable planned job/activity receipt (job.planned), but it does not call a provider, debit credits, or create downloadable media.",
  };
}

function createGuideNoSpendEvaluation(stage, input) {
  if (stage !== "ready_to_create") {
    return {
      stop_here: false,
      stop_stage: "ready_to_create",
      stop_reason: null,
      next_command_is_live_create: false,
      live_create_command_field: null,
      live_create_allowed_when: null,
      recommended_command_field: null,
      recommended_command: null,
      recommended_command_label: null,
      recommended_command_effect: null,
      warning: null,
    };
  }
  return {
    stop_here: true,
    stop_stage: "ready_to_create",
    stop_reason:
      "ready_to_create means data.next_command is a live media create; no-spend evaluators should stop before it unless media spend is allowed.",
    next_command_is_live_create: true,
    live_create_command_field: "next_command",
    live_create_allowed_when: "media_spend_allowed",
    recommended_command_field: "recommended_no_spend_command",
    recommended_command: input.noSpendNextCommand,
    recommended_command_label: input.noSpendNextCommandLabel,
    recommended_command_effect: input.noSpendNextCommandEffect,
    warning:
      "For no-spend verification at ready_to_create, run data.recommended_no_spend_command instead of data.next_command.",
  };
}

function createGuideRecovery(stage, input) {
  let noSpendCommand = null;
  let noSpendCommandField = null;
  if (stage === "ready_to_create" && input.noSpendNextCommand !== null) {
    noSpendCommand = input.noSpendNextCommand;
    noSpendCommandField = "recommended_no_spend_command";
  } else if (stage === "quota_required") {
    noSpendCommand = input.escapeHatches.quota;
    noSpendCommandField = "escape_hatches.quota";
  } else if (
    stage === "no_executable_model" ||
    stage === "service_unreachable"
  ) {
    noSpendCommand = input.nextCommand;
    noSpendCommandField = "next_command";
  } else if (stage === "auth_required" || stage === "prompt_required") {
    noSpendCommand = input.nextCommand;
    noSpendCommandField = "next_command";
  }
  const noSpendMissingInputs =
    noSpendCommand === null
      ? []
      : createGuideNextCommandMissingInputs(noSpendCommand);
  const liveCreateCommandField =
    stage === "ready_to_create" ? "next_command" : null;
  const livePaymentCommandField =
    stage === "quota_required" && input.selfFundNextCommand !== null
      ? "self_fund_next_command"
      : null;
  const doubleSpendGuardRequired =
    liveCreateCommandField !== null || livePaymentCommandField !== null;
  return {
    schema: "image-skill.guide-recovery.v1",
    stage,
    precondition_code: input.blocker?.code ?? null,
    precondition_message: input.blocker?.message ?? null,
    no_spend_command: noSpendCommand,
    no_spend_command_field: noSpendCommandField,
    no_spend_command_copy_runnable:
      noSpendCommand === null ? null : noSpendMissingInputs.length === 0,
    no_spend_command_missing_inputs: noSpendMissingInputs,
    after_success_command: input.afterNext,
    after_success_command_field: input.afterNext === null ? null : "after_next",
    live_create_command_field: liveCreateCommandField,
    live_payment_command_field: livePaymentCommandField,
    double_spend_guard: {
      required: doubleSpendGuardRequired,
      safe_rerun_command_field: noSpendCommandField,
      warning:
        liveCreateCommandField !== null
          ? "Do not blindly rerun data.next_command after a partial or unknown create/edit failure; use data.guide_recovery.no_spend_command, jobs/activity, or error.recovery before any live retry."
          : livePaymentCommandField !== null
            ? "Do not blindly rerun live payment commands with fresh identifiers after a partial or unknown payment failure; use data.guide_recovery.no_spend_command and payment status recovery before any new buy."
            : "No live payment or live media command is exposed for this stage; follow the no-spend command and rerun the guide after the precondition is satisfied.",
    },
  };
}

function createGuideWarning(stage, input) {
  const effect = input.nextCommandEffect;
  const base = {
    stage,
    no_spend_safe:
      effect.no_spend &&
      !effect.provider_call &&
      !effect.payment_object &&
      !effect.credit_debit &&
      !effect.media_write,
    live_money_action: false,
    spend_required: false,
    provider_call: effect.provider_call,
    payment_object: effect.payment_object,
    credit_debit: effect.credit_debit,
    media_write: effect.media_write,
    payment_top_up_path: null,
  };

  if (stage === "prompt_required") {
    return {
      ...base,
      next_command_safety: "rerun_guide_no_spend",
      recommended_command_field: "next_command",
      warning: input.nextCommandCopyRunnable
        ? "data.next_command reruns the free guide with a real prompt; it does not call a provider, open payment, debit credits, or create media."
        : "data.next_command is a no-spend guide template; fill data.next_command_missing_inputs before running it. It does not call a provider, open payment, debit credits, or create media.",
    };
  }
  if (stage === "no_executable_model" || stage === "service_unreachable") {
    return {
      ...base,
      next_command_safety: "read_only_inspection_no_spend",
      recommended_command_field: "next_command",
      warning:
        "data.next_command is read-only inspection/recovery; it does not call a provider, open payment, debit credits, or create media.",
    };
  }
  if (stage === "auth_required") {
    return {
      ...base,
      next_command_safety: "hosted_signup_no_spend_setup",
      recommended_command_field: "next_command",
      warning: input.nextCommandCopyRunnable
        ? "data.next_command is no-spend hosted signup/setup; it creates a restricted agent identity but does not call a provider, open payment, debit credits, or create media."
        : "data.next_command is a no-spend hosted signup/setup template; fill data.next_command_missing_inputs before running it. It creates a restricted agent identity but does not call a provider, open payment, debit credits, or create media.",
    };
  }
  if (stage === "quota_required") {
    const paymentTopUpPath =
      input.paymentSummary.preferred_method_summary?.top_up_path ?? null;
    return {
      ...base,
      next_command_safety: "live_money_payment_action",
      no_spend_safe: false,
      live_money_action: true,
      spend_required: true,
      recommended_command_field: "escape_hatches",
      payment_top_up_path: paymentTopUpPath,
      warning: input.nextCommandCopyRunnable
        ? paymentTopUpPath === "browserless_agent_self_fund"
          ? "data.next_command starts the browserless live-money top-up path; stay within the delegated cap, or use data.escape_hatches.payment_methods for read-only payment inspection."
          : paymentTopUpPath === "human_payment_handoff"
            ? "data.next_command starts a live-money payment handoff that needs human or browser completion; stay within the delegated cap, or use data.escape_hatches.payment_methods for read-only inspection."
            : "data.next_command starts payment or quota recovery; inspect data.checks.payments before attempting live money, or use data.escape_hatches.payment_methods for read-only inspection."
        : paymentTopUpPath === "browserless_agent_self_fund"
          ? "data.next_command is a browserless live-money top-up template; fill data.next_command_missing_inputs before running it, stay within the delegated cap, or use data.escape_hatches.payment_methods for read-only payment inspection."
          : paymentTopUpPath === "human_payment_handoff"
            ? "data.next_command is a live-money payment handoff template; fill data.next_command_missing_inputs before running it, stay within the delegated cap, or use data.escape_hatches.payment_methods for read-only inspection."
            : "data.next_command is a live-money payment template; fill data.next_command_missing_inputs before running it, stay within the delegated cap, or use data.escape_hatches.payment_methods for read-only inspection.",
    };
  }
  return {
    ...base,
    next_command_safety: "live_media_create_credit_debit",
    no_spend_safe: false,
    spend_required: true,
    recommended_command_field: "recommended_no_spend_command",
    warning:
      "data.next_command is a live media create that can call a provider, debit credits, and create media. Run it only when media spend is allowed; otherwise run data.recommended_no_spend_command.",
  };
}

function createGuideNextCommandMissingInputs(command) {
  return GUIDE_NEXT_COMMAND_PLACEHOLDERS.filter((placeholder) =>
    commandContainsTemplateToken(command, placeholder.placeholder),
  ).map((placeholder) => ({
    flag: placeholder.flag,
    placeholder: placeholder.placeholder,
    value_description: placeholder.value_description,
    example: placeholder.example,
  }));
}

function createGuideEffectPlaceholders(missingInputs) {
  return missingInputs.map((input) => {
    const placeholder = GUIDE_NEXT_COMMAND_PLACEHOLDERS.find(
      (candidate) => candidate.placeholder === input.placeholder,
    );
    return {
      token: input.placeholder,
      description: placeholder?.effect_description ?? input.value_description,
      required: true,
    };
  });
}

function commandContainsTemplateToken(command, token) {
  return new RegExp(`(^|[^\\w])${escapeRegExp(token)}(?=$|[^\\w])`).test(
    command,
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createGuideNextCommand(stage, input) {
  if (stage === "prompt_required") {
    return renderGuideCommand("PROMPT", input.apiBaseUrl, input.commandPrefix, {
      operation: input.guideOperation,
      inputReference: input.inputReference,
      modelId: input.requestedModelId,
      providerId: input.requestedProviderId,
      intent: input.requestedIntentFlag,
      maxEstimatedUsdPerImage: input.maxEstimatedUsdPerImage,
      modelParametersJson: input.modelParametersJson,
    });
  }
  if (stage === "no_executable_model" || stage === "service_unreachable") {
    return renderGuidePrefixedCommand(
      input.commandPrefix,
      "models list --json",
    );
  }
  if (stage === "auth_required") {
    return renderGuideSignupCommand(input);
  }
  if (stage === "quota_required") {
    return (
      firstPaymentActionCommand(input.paymentSummary.suggested_commands) ??
      renderGuidePrefixedCommand(input.commandPrefix, "credits methods --json")
    );
  }
  if (createGuideSelectedModelRequiresInputImage(input.selected)) {
    return renderInputImageGuideCommand({
      modelId: input.selected.id,
      prompt: input.prompt,
      inputReference: input.inputReference,
      budgetGuard: input.budgetGuard,
      modelParametersJson: input.modelParametersJson,
      dryRun: false,
      idempotencyKey: `edit-guide-${Date.now()}-${randomBytes(4).toString("hex")}`,
      apiBaseUrl: input.apiBaseUrl,
      commandPrefix: input.commandPrefix,
    });
  }
  return renderCreateCommand({
    prompt: input.prompt,
    modelId: input.selected.id,
    providerId: input.requestedProviderId,
    intent: input.requestedIntent,
    budgetGuard: input.budgetGuard,
    aspectRatio: input.aspectRatio,
    modelParametersJson: input.modelParametersJson,
    dryRun: false,
    // Retry-safe by default (#1228): bake a stable idempotency key into the
    // advertised create command so an agent that copies it and retries after a
    // transient 502 does not double-charge.
    idempotencyKey: `create-guide-${Date.now()}-${randomBytes(4).toString("hex")}`,
    apiBaseUrl: input.apiBaseUrl,
    commandPrefix: input.commandPrefix,
  });
}

function createGuideEscapeHatches(input) {
  return {
    doctor: renderGuidePrefixedCommand(input.commandPrefix, "doctor --json"),
    model_inspection:
      input.selected === null
        ? renderGuidePrefixedCommand(input.commandPrefix, "models list --json")
        : renderGuidePrefixedCommand(
            input.commandPrefix,
            `models show ${shellQuote(input.selected.id)} --json`,
          ),
    payment_methods: renderGuidePrefixedCommand(
      input.commandPrefix,
      "credits methods --json",
    ),
    quota: renderGuidePrefixedCommand(
      input.commandPrefix,
      "usage quota --json",
    ),
    dry_run:
      input.selected === null ||
      (input.prompt.length === 0 &&
        !PROMPTLESS_EDIT_MODEL_IDS.has(input.selected.id))
        ? renderGuidePrefixedCommand(
            input.commandPrefix,
            input.guideOperation === "edit"
              ? "edit --dry-run --input image_... --prompt PROMPT --json"
              : "create --dry-run --prompt PROMPT --json",
          )
        : createGuideSelectedModelRequiresInputImage(input.selected)
          ? renderInputImageGuideCommand({
              modelId: input.selected.id,
              prompt: input.prompt,
              inputReference: input.inputReference,
              budgetGuard: input.budgetGuard,
              modelParametersJson: input.modelParametersJson,
              dryRun: true,
              apiBaseUrl: input.apiBaseUrl,
              commandPrefix: input.commandPrefix,
            })
          : renderCreateCommand({
              prompt: input.prompt,
              modelId: input.selected.id,
              providerId: input.requestedProviderId,
              intent: input.requestedIntent,
              budgetGuard: input.budgetGuard,
              aspectRatio: input.aspectRatio,
              modelParametersJson: input.modelParametersJson,
              dryRun: true,
              apiBaseUrl: input.apiBaseUrl,
              commandPrefix: input.commandPrefix,
            }),
  };
}

function renderGuideCommand(
  prompt,
  apiBaseUrl,
  commandPrefix = "image-skill",
  options = {},
) {
  const operation = options.operation ?? "create";
  return [
    commandPrefix,
    `${operation} --guide --prompt`,
    shellQuote(prompt),
    ...(operation === "edit" &&
    typeof options.inputReference === "string" &&
    options.inputReference.trim().length > 0
      ? ["--input", shellQuote(options.inputReference.trim())]
      : []),
    ...(options.modelId === null ||
    options.modelId === undefined ||
    options.modelId === ""
      ? []
      : ["--model", shellQuote(options.modelId)]),
    ...(options.providerId === null ||
    options.providerId === undefined ||
    options.providerId === ""
      ? []
      : ["--provider", shellQuote(options.providerId)]),
    ...(options.intent === null ||
    options.intent === undefined ||
    options.intent === ""
      ? []
      : ["--intent", shellQuote(options.intent)]),
    ...(options.maxEstimatedUsdPerImage === null ||
    options.maxEstimatedUsdPerImage === undefined
      ? []
      : [
          "--max-estimated-usd-per-image",
          shellQuote(formatUsd(options.maxEstimatedUsdPerImage)),
        ]),
    ...(options.modelParametersJson === null ||
    options.modelParametersJson === undefined
      ? []
      : ["--model-parameters-json", shellQuote(options.modelParametersJson)]),
    ...(apiBaseUrl === null ? [] : ["--api-base-url", shellQuote(apiBaseUrl)]),
    "--json",
  ].join(" ");
}

function renderGuideSignupCommand(input) {
  // Anonymous signup (decision 0030): no contact placeholder in the handoff —
  // the agent still substitutes its own name/runtime, but no longer has to
  // find (or invent) an inbox before it can authenticate.
  const signupCommand = [
    "signup --agent --agent-name AGENT_NAME --runtime RUNTIME_NAME",
    ...(input.apiBaseUrl === null
      ? []
      : ["--api-base-url", shellQuote(input.apiBaseUrl)]),
    "--json",
  ].join(" ");
  return renderGuidePrefixedCommand(input.commandPrefix, signupCommand);
}

function renderTokenStdinCommand(command) {
  return `printf '%s\\n' "$IMAGE_SKILL_TOKEN" | ${command} --token-stdin`;
}

function firstPaymentActionCommand(commands) {
  return (
    commands.find((command) => /\bcredits\s+quote\b/.test(command)) ??
    commands.find((command) => /\bcredits\s+buy\b/.test(command)) ??
    commands.find((command) => /\bcredits\s+methods\b/.test(command)) ??
    commands[0] ??
    "image-skill credits methods --json"
  );
}

function guidePaymentCommandByKind(commands, kind, commandPrefix = null) {
  const pattern =
    kind === "quote"
      ? /\bcredits\s+quote\b/
      : kind === "buy"
        ? /\bcredits\s+buy\b/
        : /\bcredits\s+status\b/;
  const command = commands.find((candidate) => pattern.test(candidate)) ?? null;
  if (command === null || commandPrefix === null) {
    return command;
  }
  return renderGuidePrefixedCommand(commandPrefix, command);
}

function guidePaymentInspectionCommand(commands, kind) {
  const pattern =
    kind === "methods" ? /\bcredits\s+methods\b/ : /\bcredits\s+packs\s+list\b/;
  return commands.find((command) => pattern.test(command)) ?? null;
}

function renderInputImageGuideCommand(input) {
  const promptless = PROMPTLESS_EDIT_MODEL_IDS.has(input.modelId);
  return [
    input.commandPrefix ?? "image-skill",
    "edit",
    ...(input.dryRun ? ["--dry-run"] : []),
    "--input",
    input.inputReference?.trim()
      ? shellQuote(input.inputReference.trim())
      : "image_...",
    "--model",
    shellQuote(input.modelId),
    ...(promptless ? [] : ["--prompt", shellQuote(input.prompt)]),
    "--max-estimated-usd-per-image",
    shellQuote(formatUsd(input.budgetGuard)),
    ...(input.modelParametersJson === null ||
    input.modelParametersJson === undefined
      ? []
      : ["--model-parameters-json", shellQuote(input.modelParametersJson)]),
    ...(input.idempotencyKey === undefined || input.idempotencyKey === null
      ? []
      : ["--idempotency-key", shellQuote(input.idempotencyKey)]),
    ...(input.apiBaseUrl === null
      ? []
      : ["--api-base-url", shellQuote(input.apiBaseUrl)]),
    "--json",
  ].join(" ");
}

function renderCreateCommand(input) {
  return [
    input.commandPrefix ?? "image-skill",
    "create",
    ...(input.dryRun ? ["--dry-run"] : []),
    ...(input.providerId === null
      ? []
      : ["--provider", shellQuote(input.providerId)]),
    "--model",
    shellQuote(input.modelId),
    "--prompt",
    shellQuote(input.prompt),
    "--intent",
    shellQuote(input.intent),
    ...(input.aspectRatio === null || input.aspectRatio === undefined
      ? []
      : ["--aspect-ratio", shellQuote(input.aspectRatio)]),
    "--max-estimated-usd-per-image",
    shellQuote(formatUsd(input.budgetGuard)),
    ...(input.modelParametersJson === null ||
    input.modelParametersJson === undefined
      ? []
      : ["--model-parameters-json", shellQuote(input.modelParametersJson)]),
    ...(input.idempotencyKey === undefined || input.idempotencyKey === null
      ? []
      : ["--idempotency-key", shellQuote(input.idempotencyKey)]),
    ...(input.apiBaseUrl === null
      ? []
      : ["--api-base-url", shellQuote(input.apiBaseUrl)]),
    "--json",
  ].join(" ");
}

function renderGuidePrefixedCommand(commandPrefix, command) {
  return `${commandPrefix} ${stripImageSkillCommandPrefix(command)}`;
}

function createGuideCommandPrefix(input = {}) {
  const configPath =
    input.configPath === undefined
      ? configuredImageSkillConfigPath()
      : input.configPath;
  // Discovery-source attribution (#1814) must survive the guide handoff into
  // the fresh-process replay commands, or the slug dies before signup.
  const discoverySource = configuredDiscoverySource();
  return renderShellEnvPrefixedCommand(
    {
      npm_config_update_notifier: "false",
      ...(configPath === null ? {} : { IMAGE_SKILL_CONFIG_PATH: configPath }),
      ...(discoverySource === null
        ? {}
        : { IMAGE_SKILL_DISCOVERY_SOURCE: discoverySource }),
    },
    "npx -y image-skill@latest",
  );
}

function configuredDiscoverySource() {
  const value = process.env.IMAGE_SKILL_DISCOVERY_SOURCE;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function configuredImageSkillConfigPath() {
  const configPath = process.env.IMAGE_SKILL_CONFIG_PATH;
  return typeof configPath === "string" && configPath.length > 0
    ? configPath
    : null;
}

function renderShellEnvPrefixedCommand(env, command) {
  const assignments = Object.entries(env).map(
    ([name, value]) => `${name}=${shellEnvAssignmentValue(name, value)}`,
  );
  return assignments.length === 0
    ? command
    : `${assignments.join(" ")} ${command}`;
}

function shellEnvAssignmentValue(name, value) {
  if (name.startsWith("npm_config_") && /^(?:true|false|\d+)$/.test(value)) {
    return value;
  }
  return shellQuote(value);
}

function renderWritableConfigCommand(command) {
  return `IMAGE_SKILL_CONFIG_PATH="${LOCAL_WRITABLE_CONFIG_PATH}" ${command}`;
}

function stripImageSkillCommandPrefix(command) {
  return String(command ?? "").replace(/^image-skill\s+/, "");
}

function explicitApiBaseUrl(args) {
  return flagString(args, "api-base-url");
}

function formatUsd(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function shellQuote(value) {
  return JSON.stringify(value);
}

function quotaRemainingCredits(data) {
  if (data === null || data === undefined) {
    return null;
  }
  const limits = data.limits ?? {};
  const freeCredits =
    typeof limits.remaining_credits === "number" ? limits.remaining_credits : 0;
  const paidCredits =
    typeof limits.payment_backed_remaining_credits === "number"
      ? limits.payment_backed_remaining_credits
      : 0;
  return freeCredits + paidCredits;
}

async function create(argv) {
  const args = parseArgs(argv);
  if (flagBool(args, "guide")) {
    return createGuide(args);
  }
  const prompt = await promptValue(args);
  if (!prompt.ok) {
    return prompt.result;
  }
  let referenceToken = null;
  if (flagBool(args, "dry-run") && hasReferenceFlags(args)) {
    referenceToken = await resolveToken(args);
    if (!referenceToken.ok) {
      return referenceToken.result;
    }
  }
  const referencePlan = parseReferencePlan(args, "image-skill create");
  if (!referencePlan.ok) {
    return referencePlan.result;
  }
  const anonymousDryRun =
    flagBool(args, "dry-run") && referencePlan.referencePlans.length === 0;
  const token =
    referenceToken ??
    (await resolveToken(args, { allowMissing: anonymousDryRun }));
  if (!token.ok) {
    return token.result;
  }
  const modelParameters = jsonObjectFlag(args, "model-parameters-json");
  if (!modelParameters.ok) {
    return modelParameters.result;
  }
  const outputCount = positiveIntegerFlag(args, "output-count", {
    command: "image-skill create",
  });
  if (!outputCount.ok) {
    return outputCount.result;
  }
  const references =
    token.token === null
      ? { ok: true, references: [] }
      : await resolveReferences(
          referencePlan.referencePlans,
          args,
          token.token,
        );
  if (!references.ok) {
    return references.result;
  }
  // A live (non-dry-run, authenticated) create is the only branch that spends
  // credits. Give it a recovery handle BEFORE the blocking request (#1789).
  const isLiveSpend = !flagBool(args, "dry-run") && token.token !== null;
  const idempotencyKey = isLiveSpend
    ? liveSpendIdempotencyKey(args, "create")
    : flagString(args, "idempotency-key");
  const inFlight = isLiveSpend
    ? await recordInFlightSpend({
        command: "image-skill create",
        operation: "create",
        idempotencyKey,
        argv,
      })
    : null;
  const commandPrefix = createGuideCommandPrefix();
  const result = withCopyRunnablePaymentNextActionCommands(
    withCopyRunnableQuotaRecoveryCommands(
      await apiRequest({
        command: "image-skill create",
        method: "POST",
        apiBaseUrl: apiBase(args),
        path: "/v1/create",
        ...(token.token === null ? {} : { token: token.token }),
        body: {
          prompt: prompt.value,
          ...(flagString(args, "provider") === null
            ? {}
            : { provider: flagString(args, "provider") }),
          ...(flagString(args, "model") === null
            ? {}
            : { model: flagString(args, "model") }),
          ...(flagString(args, "intent") === null
            ? {}
            : { intent: flagString(args, "intent") }),
          aspect_ratio: flagString(args, "aspect-ratio") ?? "1:1",
          ...(references.references.length === 0
            ? {}
            : { references: references.references }),
          ...(outputCount.value === null
            ? {}
            : { output_count: outputCount.value }),
          ...(flagNumber(args, "max-estimated-usd-per-image") === null
            ? {}
            : {
                max_estimated_usd_per_image: flagNumber(
                  args,
                  "max-estimated-usd-per-image",
                ),
              }),
          ...(modelParameters.value === null
            ? {}
            : { model_parameters: modelParameters.value }),
          // Retry-safe dedupe (#1228/#1789): a live create always carries a key so a
          // retry (or an interrupted-then-recovered run) dedupes to one charge.
          ...(idempotencyKey === null
            ? {}
            : { idempotency_key: idempotencyKey }),
          dry_run: flagBool(args, "dry-run"),
          accept_unknown_cost: flagBool(args, "accept-unknown-cost"),
        },
      }),
      commandPrefix,
    ),
    commandPrefix,
  );
  await clearInFlightSpendForResult(inFlight, result);
  return result;
}

async function upload(argv) {
  const args = parseArgs(argv);
  const input = flagString(args, "input") ?? args.positionals[0];
  if (input === undefined) {
    return invalid("image-skill upload", "upload requires PATH_OR_URL");
  }
  const token = await resolveToken(args);
  if (!token.ok) {
    return token.result;
  }
  const uploadBody = await uploadPayload(input);
  if (!uploadBody.ok) {
    return uploadBody.result;
  }
  return apiRequest({
    command: "image-skill upload",
    method: "POST",
    apiBaseUrl: apiBase(args),
    path: "/v1/upload",
    token: token.token,
    body: uploadBody.body,
  });
}

async function edit(argv) {
  const args = parseArgs(argv);
  const input = flagString(args, "input") ?? args.positionals[0];
  const modelId = flagString(args, "model");
  if (flagBool(args, "guide")) {
    return createGuide(args, {
      guideOperation: "edit",
      inputReference: input,
    });
  }
  if (input === undefined) {
    return invalid(
      "image-skill edit",
      "edit requires --input ASSET_ID_OR_PATH_OR_URL",
    );
  }
  const prompt = await editPromptValue(args, modelId);
  if (!prompt.ok) {
    return prompt.result;
  }
  const token = await resolveToken(args);
  if (!token.ok) {
    return token.result;
  }
  const referencePlan = parseReferencePlan(args, "image-skill edit");
  if (!referencePlan.ok) {
    return referencePlan.result;
  }
  const assetId = await resolveInputAssetId(input, args, token.token);
  if (!assetId.ok) {
    return assetId.result;
  }
  const mask = flagString(args, "mask");
  const maskAssetId =
    mask === null ? null : await resolveInputAssetId(mask, args, token.token);
  if (maskAssetId !== null && !maskAssetId.ok) {
    return maskAssetId.result;
  }
  const references = await resolveReferences(
    referencePlan.referencePlans,
    args,
    token.token,
  );
  if (!references.ok) {
    return references.result;
  }
  const modelParameters = jsonObjectFlag(args, "model-parameters-json");
  if (!modelParameters.ok) {
    return modelParameters.result;
  }
  // A live (non-dry-run) edit spends credits; give it a recovery handle BEFORE
  // the blocking request (#1789). Edit always carries a token.
  const isLiveSpend = !flagBool(args, "dry-run");
  const idempotencyKey = isLiveSpend
    ? liveSpendIdempotencyKey(args, "edit")
    : flagString(args, "idempotency-key");
  const inFlight = isLiveSpend
    ? await recordInFlightSpend({
        command: "image-skill edit",
        operation: "edit",
        idempotencyKey,
        argv,
      })
    : null;
  const commandPrefix = createGuideCommandPrefix();
  const result = withCopyRunnablePaymentNextActionCommands(
    withCopyRunnableQuotaRecoveryCommands(
      await apiRequest({
        command: "image-skill edit",
        method: "POST",
        apiBaseUrl: apiBase(args),
        path: "/v1/edit",
        token: token.token,
        body: {
          input_asset_id: assetId.assetId,
          ...(maskAssetId === null
            ? {}
            : { mask_asset_id: maskAssetId.assetId }),
          ...(references.references.length === 0
            ? {}
            : { references: references.references }),
          ...(prompt.value.length === 0 ? {} : { prompt: prompt.value }),
          ...(flagString(args, "provider") === null
            ? {}
            : { provider: flagString(args, "provider") }),
          ...(modelId === null ? {} : { model: modelId }),
          ...(flagString(args, "intent") === null
            ? {}
            : { intent: flagString(args, "intent") }),
          aspect_ratio: flagString(args, "aspect-ratio") ?? "auto",
          ...(flagNumber(args, "max-estimated-usd-per-image") === null
            ? {}
            : {
                max_estimated_usd_per_image: flagNumber(
                  args,
                  "max-estimated-usd-per-image",
                ),
              }),
          ...(modelParameters.value === null
            ? {}
            : { model_parameters: modelParameters.value }),
          ...(flagBool(args, "dry-run") ? { dry_run: true } : {}),
          // Retry-safe dedupe (#1228/#1789): a live edit always carries a key so a
          // retry (or an interrupted-then-recovered run) dedupes to one charge.
          ...(idempotencyKey === null
            ? {}
            : { idempotency_key: idempotencyKey }),
          accept_unknown_cost: flagBool(args, "accept-unknown-cost"),
        },
      }),
      commandPrefix,
    ),
    commandPrefix,
  );
  await clearInFlightSpendForResult(inFlight, result);
  return result;
}

async function assets(argv) {
  const [subcommand, ...rest] = argv;
  const args = parseArgs(rest);
  const reference = args.positionals[0] ?? flagString(args, "id");
  if (reference === undefined || reference === null) {
    return invalid("image-skill assets", "assets requires an asset id or URL");
  }
  const assetId = assetIdFromReference(reference);
  if (assetId === null) {
    return invalid(
      "image-skill assets",
      "assets currently supports Image Skill asset ids and media.image-skill.com URLs",
    );
  }
  const token = await resolveToken(args);
  if (!token.ok) {
    return token.result;
  }
  if (subcommand === "show") {
    return withCopyRunnablePaymentNextActionCommands(
      await apiRequest({
        command: "image-skill assets show",
        method: "GET",
        apiBaseUrl: apiBase(args),
        path: `/v1/assets/${encodeURIComponent(assetId)}`,
        token: token.token,
      }),
      createGuideCommandPrefix(),
    );
  }
  if (subcommand === "get") {
    const shown = withCopyRunnablePaymentNextActionCommands(
      await apiRequest({
        command: "image-skill assets get",
        method: "GET",
        apiBaseUrl: apiBase(args),
        path: `/v1/assets/${encodeURIComponent(assetId)}`,
        token: token.token,
      }),
      createGuideCommandPrefix(),
    );
    if (!shown.envelope.ok) {
      return shown;
    }
    const asset = shown.envelope.data?.asset ?? shown.envelope.data;
    const nextActions = shown.envelope.data?.next_actions;
    const output =
      flagString(args, "output") ?? deriveAssetGetOutputPath(asset);
    const downloaded = await downloadUrl(asset.url, output, {
      overwrite: flagBool(args, "overwrite"),
    });
    if (!downloaded.ok) {
      return downloaded.result;
    }
    shown.envelope.command = "image-skill assets get";
    shown.envelope.data = {
      request: {
        reference,
        reference_type: reference === assetId ? "asset_id" : "url",
      },
      asset,
      download: downloaded.data,
      ...(nextActions === undefined ? {} : { next_actions: nextActions }),
    };
    return shown;
  }
  return invalid("image-skill assets", "assets requires show or get");
}

async function jobs(argv) {
  const [subcommand, ...rest] = argv;
  const args = parseArgs(rest);
  const jobId = args.positionals[0] ?? flagString(args, "job-id");
  if (jobId === undefined || jobId === null) {
    return invalid("image-skill jobs", "jobs requires JOB_ID");
  }
  const token = await resolveToken(args);
  if (!token.ok) {
    return token.result;
  }
  if (subcommand === "show") {
    return withCopyRunnablePaymentNextActionCommands(
      await apiRequest({
        command: "image-skill jobs show",
        method: "GET",
        apiBaseUrl: apiBase(args),
        path: `/v1/jobs/${encodeURIComponent(jobId)}`,
        token: token.token,
      }),
      createGuideCommandPrefix(),
    );
  }
  if (subcommand === "wait") {
    const timeoutMs = flagNumber(args, "timeout-ms") ?? 30_000;
    const pollIntervalMs = flagNumber(args, "poll-interval-ms") ?? 1_000;
    const started = Date.now();
    while (Date.now() - started <= timeoutMs) {
      const current = withCopyRunnablePaymentNextActionCommands(
        await apiRequest({
          command: "image-skill jobs wait",
          method: "GET",
          apiBaseUrl: apiBase(args),
          path: `/v1/jobs/${encodeURIComponent(jobId)}`,
          token: token.token,
        }),
        createGuideCommandPrefix(),
      );
      if (!current.envelope.ok) {
        return current;
      }
      const status = current.envelope.data?.job?.status;
      if (
        status === "completed" ||
        status === "failed" ||
        status === "canceled"
      ) {
        current.envelope.data.request = {
          ...(current.envelope.data.request ?? {}),
          timeout_ms: timeoutMs,
          poll_interval_ms: pollIntervalMs,
        };
        return current;
      }
      await sleep(pollIntervalMs);
    }
    return failure(
      "image-skill jobs wait",
      8,
      "TIMEOUT",
      `job ${jobId} did not reach a terminal state within ${timeoutMs}ms`,
      true,
      { retry_after_seconds: Math.ceil(pollIntervalMs / 1000) },
    );
  }
  return invalid("image-skill jobs", "jobs requires show or wait");
}

async function activity(argv) {
  const [subcommand, ...rest] = argv;
  const args = parseArgs(rest);
  const token = await resolveToken(args);
  if (!token.ok) {
    return token.result;
  }
  if (subcommand === "show") {
    const reference = args.positionals[0] ?? flagString(args, "reference");
    if (reference === undefined || reference === null) {
      return invalid(
        "image-skill activity show",
        "activity show requires REFERENCE",
      );
    }
    return withCopyRunnablePaymentNextActionCommands(
      await apiRequest({
        command: "image-skill activity show",
        method: "GET",
        apiBaseUrl: apiBase(args),
        path: `/v1/activity/${encodeURIComponent(reference)}`,
        token: token.token,
      }),
      createGuideCommandPrefix(),
    );
  }
  if (subcommand === "list") {
    const query = new URLSearchParams();
    const limit = flagNumber(args, "limit");
    if (limit !== null) {
      query.set("limit", String(limit));
    }
    const subject = flagString(args, "subject");
    if (subject !== null) {
      query.set("subject", subject);
    }
    return withCopyRunnablePaymentNextActionCommands(
      await apiRequest({
        command: "image-skill activity list",
        method: "GET",
        apiBaseUrl: apiBase(args),
        path:
          query.size > 0 ? `/v1/activity?${query.toString()}` : "/v1/activity",
        token: token.token,
      }),
      createGuideCommandPrefix(),
    );
  }
  return invalid("image-skill activity", "activity requires list or show");
}

async function feedback(argv) {
  const [subcommand, ...rest] = argv;
  if (subcommand !== "create") {
    return invalid("image-skill feedback", "feedback requires create");
  }
  const args = parseArgs(rest);
  const token = await resolveToken(args);
  if (!token.ok) {
    return token.result;
  }
  const title = flagString(args, "title");
  const body = flagString(args, "body");
  if (title === null && body === null) {
    return invalid(
      "image-skill feedback create",
      "feedback create requires --title or --body",
    );
  }
  return apiRequest({
    command: "image-skill feedback create",
    method: "POST",
    apiBaseUrl: apiBase(args),
    path: "/v1/feedback",
    token: token.token,
    body: {
      type: flagString(args, "type") ?? "user_feedback",
      ...(title === null ? {} : { title }),
      ...(body === null ? {} : { body }),
      severity: flagString(args, "severity") ?? "medium",
      confidence: flagString(args, "confidence") ?? "medium",
      next_state: flagString(args, "next-state") ?? "watch",
      ...(flagString(args, "command") === null
        ? {}
        : { command: flagString(args, "command") }),
      ...(flagString(args, "expected") === null
        ? {}
        : { expected: flagString(args, "expected") }),
      ...(flagString(args, "actual") === null
        ? {}
        : { actual: flagString(args, "actual") }),
      ...(flagString(args, "friction") === null
        ? {}
        : { friction: flagString(args, "friction") }),
      ...(flagString(args, "proof-needed") === null
        ? {}
        : { proof_needed: flagString(args, "proof-needed") }),
      ...(flagString(args, "strategic-reason") === null
        ? {}
        : { strategic_reason: flagString(args, "strategic-reason") }),
      ...(flagString(args, "dedupe-key") === null
        ? {}
        : { dedupe_key: flagString(args, "dedupe-key") }),
      ...(flagString(args, "source") === null
        ? {}
        : { source: flagString(args, "source") }),
      ...(flagString(args, "trace-id") === null
        ? {}
        : { trace_id: flagString(args, "trace-id") }),
      surface: csvFlag(args, "surface", ["cli"]),
      evidence: csvFlag(args, "evidence", []),
      ...(flagBool(args, "allow-weak-signal")
        ? { allow_weak_signal: true }
        : {}),
    },
  });
}

async function resolveInputAssetId(input, args, token) {
  const direct = assetIdFromReference(input);
  if (direct !== null) {
    return { ok: true, assetId: direct };
  }
  const payload = await uploadPayload(input);
  if (!payload.ok) {
    return payload;
  }
  const uploaded = await apiRequest({
    command: "image-skill upload",
    method: "POST",
    apiBaseUrl: apiBase(args),
    path: "/v1/upload",
    token,
    body: payload.body,
  });
  if (!uploaded.envelope.ok) {
    return { ok: false, result: uploaded };
  }
  const assetId = uploaded.envelope.data?.asset?.asset_id;
  if (typeof assetId !== "string") {
    return {
      ok: false,
      result: failure(
        "image-skill upload",
        9,
        "UPLOAD_ASSET_ID_MISSING",
        "hosted upload did not return an asset id",
        true,
      ),
    };
  }
  return { ok: true, assetId };
}

function parseReferencePlan(args, command) {
  for (const flag of [
    "element-frontal",
    "element-reference",
    "reference-image",
  ]) {
    if (
      args.flags.has(flag) &&
      args.flags.get(flag)?.some((value) => typeof value !== "string")
    ) {
      return {
        ok: false,
        result: invalid(command, `--${flag} requires an image`),
      };
    }
  }
  const referencePlans = [];
  for (const value of flagStrings(args, "element-frontal")) {
    const parsed = parseElementReferenceFlag(value, {
      flag: "--element-frontal",
      allowReferenceIndex: false,
      command,
    });
    if (!parsed.ok) {
      return parsed;
    }
    referencePlans.push({
      input: parsed.input,
      role: "element_frontal",
      index: parsed.index,
      referenceIndex: null,
      referenceTask: null,
    });
  }
  for (const value of flagStrings(args, "element-reference")) {
    const parsed = parseElementReferenceFlag(value, {
      flag: "--element-reference",
      allowReferenceIndex: true,
      command,
    });
    if (!parsed.ok) {
      return parsed;
    }
    referencePlans.push({
      input: parsed.input,
      role: "element_reference",
      index: parsed.index,
      referenceIndex: parsed.referenceIndex,
      referenceTask: null,
    });
  }
  for (const value of flagStrings(args, "reference-image")) {
    const parsed = parseReferenceImageFlag(value, {
      flag: "--reference-image",
      command,
    });
    if (!parsed.ok) {
      return parsed;
    }
    referencePlans.push({
      input: parsed.input,
      role: "reference_image",
      index: parsed.index,
      referenceIndex: null,
      referenceTask: parsed.referenceTask,
    });
  }
  const planValidation = validateElementReferencePlan(referencePlans, command);
  if (!planValidation.ok) {
    return planValidation;
  }
  return { ok: true, referencePlans };
}

function hasReferenceFlags(args) {
  return (
    args.flags.has("element-frontal") ||
    args.flags.has("element-reference") ||
    args.flags.has("reference-image")
  );
}

async function resolveReferences(referencePlans, args, token) {
  const references = [];
  for (const plan of referencePlans) {
    const assetId = await resolveInputAssetId(plan.input, args, token);
    if (!assetId.ok) {
      return assetId;
    }
    if (plan.role === "element_frontal") {
      references.push({
        asset_id: assetId.assetId,
        role: "element_frontal",
        index: plan.index,
      });
      continue;
    }
    if (plan.role === "reference_image") {
      references.push({
        asset_id: assetId.assetId,
        role: "reference_image",
        index: plan.index,
        ...(plan.referenceTask === null
          ? {}
          : { reference_task: plan.referenceTask }),
      });
      continue;
    }
    references.push({
      asset_id: assetId.assetId,
      role: "element_reference",
      index: plan.index,
      ...(plan.referenceIndex === null
        ? {}
        : { reference_index: plan.referenceIndex }),
    });
  }
  return { ok: true, references };
}

function validateElementReferencePlan(referencePlans, command) {
  if (referencePlans.length === 0) {
    return { ok: true };
  }
  const frontals = new Set();
  const referencesByElement = new Map();
  const elementIndexes = new Set();
  for (const plan of referencePlans) {
    if (plan.role === "reference_image") {
      continue;
    }
    elementIndexes.add(plan.index);
    if (plan.role === "element_frontal") {
      if (frontals.has(plan.index)) {
        return {
          ok: false,
          result: invalid(
            command,
            `only one --element-frontal is allowed for element ${plan.index}`,
          ),
        };
      }
      frontals.add(plan.index);
    } else {
      const count = referencesByElement.get(plan.index) ?? 0;
      referencesByElement.set(plan.index, count + 1);
    }
  }

  const sortedIndexes = [...elementIndexes].sort((left, right) => left - right);
  for (let expected = 0; expected < sortedIndexes.length; expected += 1) {
    if (sortedIndexes[expected] !== expected) {
      return {
        ok: false,
        result: invalid(
          command,
          "element indexes must be contiguous starting at 0",
        ),
      };
    }
  }
  for (const [index, count] of referencesByElement.entries()) {
    if (!frontals.has(index)) {
      return {
        ok: false,
        result: invalid(
          command,
          `--element-reference for element ${index} requires --element-frontal for the same element`,
        ),
      };
    }
    if (count > 3) {
      return {
        ok: false,
        result: invalid(
          command,
          `element ${index} accepts at most 3 --element-reference images`,
        ),
      };
    }
  }
  const referenceImageIndexes = new Set();
  for (const plan of referencePlans) {
    if (plan.role !== "reference_image") {
      continue;
    }
    if (referenceImageIndexes.has(plan.index)) {
      return {
        ok: false,
        result: invalid(
          command,
          `only one --reference-image is allowed for index ${plan.index}`,
        ),
      };
    }
    referenceImageIndexes.add(plan.index);
  }
  const sortedReferenceImageIndexes = [...referenceImageIndexes].sort(
    (left, right) => left - right,
  );
  for (
    let expected = 0;
    expected < sortedReferenceImageIndexes.length;
    expected += 1
  ) {
    if (sortedReferenceImageIndexes[expected] !== expected) {
      return {
        ok: false,
        result: invalid(
          command,
          "reference image indexes must be contiguous starting at 0",
        ),
      };
    }
  }
  return { ok: true };
}

function parseReferenceImageFlag(value, options) {
  const parsed = parseReferenceImageSuffix(value);
  if (parsed.input.length === 0) {
    return {
      ok: false,
      result: invalid(options.command, `${options.flag} requires an image`),
    };
  }
  if (parsed.index > 9) {
    return {
      ok: false,
      result: invalid(
        options.command,
        `${options.flag} index must be between 0 and 9`,
      ),
    };
  }
  return { ok: true, ...parsed };
}

function parseReferenceImageSuffix(value) {
  const atIndex = value.lastIndexOf("@");
  if (atIndex === -1) {
    return { input: value, index: 0, referenceTask: null };
  }
  const suffix = value.slice(atIndex + 1);
  if (!/^\d+(?::(?:ip|id|style))?$/.test(suffix)) {
    return { input: value, index: 0, referenceTask: null };
  }
  const [index, referenceTask] = suffix.split(":");
  return {
    input: value.slice(0, atIndex),
    index: Number(index),
    referenceTask: referenceTask ?? null,
  };
}

function parseElementReferenceFlag(value, options) {
  const parsed = parseElementReferenceSuffix(value);
  if (parsed.input.length === 0) {
    return {
      ok: false,
      result: invalid(options.command, `${options.flag} requires an image`),
    };
  }
  if (!options.allowReferenceIndex && parsed.referenceIndex !== null) {
    return {
      ok: false,
      result: invalid(
        options.command,
        `${options.flag} accepts IMAGE[@ELEMENT_INDEX], not a reference index`,
      ),
    };
  }
  if (parsed.index > 9) {
    return {
      ok: false,
      result: invalid(
        options.command,
        `${options.flag} element index must be between 0 and 9`,
      ),
    };
  }
  if (parsed.referenceIndex !== null && parsed.referenceIndex > 2) {
    return {
      ok: false,
      result: invalid(
        options.command,
        `${options.flag} reference index must be between 0 and 2`,
      ),
    };
  }
  return { ok: true, ...parsed };
}

function parseElementReferenceSuffix(value) {
  const atIndex = value.lastIndexOf("@");
  if (atIndex === -1) {
    return { input: value, index: 0, referenceIndex: null };
  }
  const suffix = value.slice(atIndex + 1);
  if (!/^\d+(?::\d+)?$/.test(suffix)) {
    return { input: value, index: 0, referenceIndex: null };
  }
  const [index, referenceIndex] = suffix.split(":").map((part) => Number(part));
  return {
    input: value.slice(0, atIndex),
    index,
    referenceIndex: referenceIndex ?? null,
  };
}

async function uploadPayload(input) {
  const isRemote = /^https?:\/\//i.test(input);
  let bytes;
  let filename;
  let remoteOrigin = null;
  let mimeType;
  if (isRemote) {
    const url = new URL(input);
    const response = await fetch(url);
    if (!response.ok) {
      return {
        ok: false,
        result: failure(
          "image-skill upload",
          7,
          "REMOTE_UPLOAD_FETCH_FAILED",
          `could not fetch remote upload URL: HTTP ${response.status}`,
          true,
        ),
      };
    }
    const arrayBuffer = await response.arrayBuffer();
    bytes = Buffer.from(arrayBuffer);
    filename = basename(url.pathname) || "remote-upload";
    remoteOrigin = url.origin;
    mimeType =
      response.headers.get("content-type")?.split(";")[0]?.toLowerCase() ??
      mimeFromFilename(filename);
  } else {
    const filePath = resolve(input);
    bytes = await readFile(filePath);
    filename = basename(filePath);
    mimeType = mimeFromFilename(filename);
  }
  if (mimeType === null) {
    return {
      ok: false,
      result: failure(
        "image-skill upload",
        2,
        "UPLOAD_MIME_TYPE_UNKNOWN",
        "could not infer MIME type; use png, jpg, jpeg, webp, gif, or avif",
        false,
      ),
    };
  }
  return {
    ok: true,
    body: {
      source_kind: isRemote ? "remote_url" : "local_path",
      filename,
      remote_origin: remoteOrigin,
      mime_type: mimeType,
      content_length: bytes.byteLength,
      sha256: sha256Hex(bytes),
      bytes_base64: bytes.toString("base64"),
    },
  };
}

async function inspectNpmPackage(input) {
  const registryUrl = new URL(
    `${encodeURIComponent(PACKAGE_NAME)}/${encodeURIComponent(VERSION)}`,
    ensureTrailingSlash(input.registryBaseUrl),
  ).toString();
  const fetched = await fetchPublicJson(registryUrl, {
    accept: "application/vnd.npm.install-v1+json, application/json",
  });
  if (!fetched.ok) {
    return {
      status: fetched.statusCode === 404 ? "not_available_yet" : "unreachable",
      checked_at: input.checkedAt,
      package: PACKAGE_NAME,
      version: VERSION,
      registry_url: registryUrl,
      dist_integrity: null,
      tarball: null,
      git_head: null,
      repository_url: null,
      attestation: {
        status: "not_available_yet",
        url: null,
      },
      error: fetched.error,
    };
  }

  const parsed = isRecord(fetched.json) ? fetched.json : {};
  const dist = isRecord(parsed.dist) ? parsed.dist : {};
  const repository = isRecord(parsed.repository) ? parsed.repository : {};
  const attestationUrl =
    isRecord(dist.attestations) && typeof dist.attestations.url === "string"
      ? dist.attestations.url
      : null;
  const version = typeof parsed.version === "string" ? parsed.version : VERSION;
  return {
    status: version === VERSION ? "verified" : "mismatched",
    checked_at: input.checkedAt,
    package: PACKAGE_NAME,
    version,
    expected_version: VERSION,
    registry_url: registryUrl,
    dist_integrity: typeof dist.integrity === "string" ? dist.integrity : null,
    tarball: typeof dist.tarball === "string" ? dist.tarball : null,
    git_head: typeof parsed.gitHead === "string" ? parsed.gitHead : null,
    repository_url:
      typeof repository.url === "string" ? repository.url : PUBLIC_REPO_URL,
    attestation: {
      status: attestationUrl === null ? "not_available_yet" : "available",
      url: attestationUrl,
    },
    error: null,
  };
}

async function inspectHostedContracts(input) {
  const contracts = [
    { key: "skill", path: "/skill.md" },
    { key: "llms", path: "/llms.txt" },
    { key: "cli", path: "/cli.md" },
  ];
  const entries = [];
  for (const contract of contracts) {
    const url = new URL(
      contract.path,
      ensureTrailingSlash(input.docsBaseUrl),
    ).toString();
    const fetched = await fetchPublicText(url, {
      accept: "text/markdown, text/plain, */*",
    });
    entries.push({
      key: contract.key,
      url,
      status: fetched.ok ? "verified" : "unreachable",
      http_status: fetched.statusCode,
      content_sha256:
        fetched.text === null
          ? null
          : `sha256:${sha256Hex(Buffer.from(fetched.text, "utf8"))}`,
      bytes:
        fetched.text === null ? null : Buffer.byteLength(fetched.text, "utf8"),
      error: fetched.error,
    });
  }
  const verified = entries.filter((entry) => entry.status === "verified");
  return {
    status: verified.length === entries.length ? "verified" : "unreachable",
    checked_at: input.checkedAt,
    contracts: entries,
  };
}

function trustHostedApi(health, apiBaseUrl, checkedAt) {
  return {
    status: health.envelope.ok ? "reachable" : "unreachable",
    checked_at: checkedAt,
    url: new URL("/healthz", ensureTrailingSlash(apiBaseUrl)).toString(),
    reachable: health.envelope.ok,
    api_status: health.envelope.data?.status ?? null,
    api_version: health.envelope.data?.api_version ?? null,
    error: health.envelope.error,
  };
}

function trustModelRegistry(models, apiBaseUrl, checkedAt) {
  const data = isRecord(models.envelope.data) ? models.envelope.data : {};
  const modelList = Array.isArray(data.models) ? data.models : [];
  const counted = countModelAvailability(modelList);
  const summary = isRecord(data.summary) ? data.summary : {};
  const executable = numberOrFallback(summary.executable, counted.executable);
  const catalogedNotWired = numberOrFallback(
    summary.cataloged_not_wired,
    counted.cataloged_not_wired,
  );
  const unavailable = numberOrFallback(
    summary.unavailable,
    counted.unavailable,
  );
  return {
    status: models.envelope.ok ? "available" : "unreachable",
    checked_at: checkedAt,
    url: new URL("/v1/models", ensureTrailingSlash(apiBaseUrl)).toString(),
    freshness: {
      source: "hosted /v1/models",
      checked_at: checkedAt,
    },
    availability_summary: {
      total: numberOrFallback(summary.total, modelList.length),
      returned: numberOrFallback(summary.returned, modelList.length),
      executable,
      cataloged_not_wired: catalogedNotWired,
      unavailable,
      providers: counted.providers,
      status_counts: counted.status_counts,
    },
    rules: [
      "Prefer executable models for create/edit.",
      "Treat cataloged_not_wired as inspect-only evidence, not spend-ready capability.",
      "Run models show MODEL_ID before using provider-native model parameters.",
    ],
    error: models.envelope.error,
  };
}

function trustPublicRepo(npmPackage) {
  const repoUrl = publicRepoUrlFromNpm(npmPackage.repository_url);
  return {
    status: repoUrl === null ? "unknown" : "checked",
    url: repoUrl,
    git_head: npmPackage.git_head,
    package_registry_url: npmPackage.registry_url,
    main_may_be_newer_than_package: true,
    note: "npm gitHead is the package-source commit when present; public main can move ahead between releases.",
  };
}

function trustProofUrls(input) {
  return {
    npm_package: {
      status: input.npmPackage.status,
      url: input.npmPackage.registry_url,
    },
    npm_attestation: input.npmPackage.attestation,
    public_repo: {
      status: input.publicRepo.status,
      url: input.publicRepo.url,
      git_head: input.publicRepo.git_head,
    },
    hosted_contracts: {
      status: input.hostedContracts.status,
      urls: input.hostedContracts.contracts.map((contract) => contract.url),
    },
    real_agent_studies: {
      status: "not_available_yet",
      url: null,
    },
  };
}

function trustWarnings(input) {
  const warnings = [];
  if (input.npmPackage.status !== "verified") {
    warnings.push(`npm package metadata is ${input.npmPackage.status}`);
  }
  if (input.npmPackage.git_head === null) {
    warnings.push("npm package gitHead is not available");
  }
  if (input.npmPackage.attestation.status !== "available") {
    warnings.push("npm provenance attestation URL is not available yet");
  }
  if (input.hostedContracts.status !== "verified") {
    warnings.push("one or more hosted contract documents could not be hashed");
  }
  if (input.hostedApi.status !== "reachable") {
    warnings.push("hosted API health is unreachable");
  }
  if (input.modelRegistry.status !== "available") {
    warnings.push("hosted model registry is unreachable");
  }
  const availability = input.modelRegistry.availability_summary;
  if (availability.executable === 0) {
    warnings.push("hosted model registry reports zero executable models");
  }
  if (availability.cataloged_not_wired > 0) {
    warnings.push(
      `hosted model registry reports ${availability.cataloged_not_wired} cataloged_not_wired model(s)`,
    );
  }
  if (input.proofUrls.real_agent_studies.status === "not_available_yet") {
    warnings.push("real-agent study proof URL is not available yet");
  }
  return warnings;
}

function trustSummary(input) {
  const hasMismatch =
    input.npmPackage.status === "mismatched" ||
    input.hostedContracts.status === "mismatched";
  const availability = input.modelRegistry.availability_summary;
  let status;
  if (input.hostedApi.status !== "reachable") {
    status = "unavailable";
  } else if (hasMismatch) {
    status = "stale_or_mismatched";
  } else if (
    input.modelRegistry.status !== "available" ||
    availability.executable === 0
  ) {
    status = "inspect_only";
  } else if (input.warnings.length > 0) {
    status = "usable_with_warnings";
  } else {
    status = "usable";
  }
  return {
    status,
    selection_hint: trustSelectionHint(status),
    top_warnings: input.warnings.slice(0, 5),
  };
}

function trustSelectionHint(status) {
  if (status === "usable" || status === "usable_with_warnings") {
    return "Use create --guide as the first creative command; use trust output as selection evidence, not as a required setup step.";
  }
  if (status === "inspect_only") {
    return "Inspect docs and model metadata, but do not assume spend-ready image generation until executable models and health are available.";
  }
  if (status === "stale_or_mismatched") {
    return "Do not rely on this package/contract combination until the mismatch is resolved or a newer package is selected.";
  }
  return "Do not select Image Skill for new work until hosted health and model registry checks recover.";
}

function trustSafeCommands() {
  return [
    {
      purpose: "trust_packet",
      command: `${PUBLIC_NPX_COMMAND_PREFIX} trust --json`,
      mutation: false,
      spend: false,
    },
    {
      purpose: "first_image_guide",
      command: `${PUBLIC_NPX_COMMAND_PREFIX} create --guide --prompt "a compact field camera on a stainless workbench" --json`,
      mutation: false,
      spend: false,
    },
    {
      purpose: "model_inspection",
      command: `${PUBLIC_NPX_COMMAND_PREFIX} models list --json`,
      mutation: false,
      spend: false,
    },
  ];
}

function countModelAvailability(models) {
  const statusCounts = {};
  const providers = new Set();
  let executable = 0;
  let catalogedNotWired = 0;
  let unavailable = 0;
  for (const model of models) {
    if (!isRecord(model)) {
      continue;
    }
    const providerId = modelProviderId(model);
    if (providerId !== null) {
      providers.add(providerId);
    }
    const status = modelAvailabilityStatus(model);
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    if (status === "executable" || status === "available") {
      executable += 1;
    }
    if (status === "cataloged_not_wired") {
      catalogedNotWired += 1;
    }
    if (model.status === "unavailable" || status === "unavailable") {
      unavailable += 1;
    }
  }
  return {
    executable,
    cataloged_not_wired: catalogedNotWired,
    unavailable,
    providers: [...providers].sort(),
    status_counts: statusCounts,
  };
}

function modelProviderId(model) {
  if (typeof model.provider_id === "string") {
    return model.provider_id;
  }
  if (isRecord(model.provider) && typeof model.provider.id === "string") {
    return model.provider.id;
  }
  if (typeof model.id === "string" && model.id.includes(".")) {
    return model.id.split(".")[0];
  }
  return null;
}

function modelAvailabilityStatus(model) {
  if (
    isRecord(model.execution) &&
    typeof model.execution.model_execution_status === "string"
  ) {
    return model.execution.model_execution_status;
  }
  if (typeof model.model_execution_status === "string") {
    return model.model_execution_status;
  }
  if (typeof model.availability_reason === "string") {
    return model.availability_reason;
  }
  if (typeof model.status === "string") {
    return model.status;
  }
  return "unknown";
}

function numberOrFallback(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function publicRepoUrlFromNpm(repositoryUrl) {
  if (typeof repositoryUrl !== "string" || repositoryUrl.trim().length === 0) {
    return PUBLIC_REPO_URL;
  }
  return repositoryUrl
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/^ssh:\/\/git@github.com\//, "https://github.com/");
}

function docsBaseForApiBaseUrl(apiBaseUrl) {
  return sameBaseUrl(apiBaseUrl, DEFAULT_API_BASE_URL)
    ? DEFAULT_DOCS_BASE_URL
    : apiBaseUrl;
}

function npmRegistryBaseForApiBaseUrl(apiBaseUrl) {
  return sameBaseUrl(apiBaseUrl, DEFAULT_API_BASE_URL)
    ? DEFAULT_NPM_REGISTRY_BASE_URL
    : apiBaseUrl;
}

function sameBaseUrl(left, right) {
  return stripTrailingSlash(left) === stripTrailingSlash(right);
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

async function fetchPublicJson(url, options = {}) {
  const fetched = await fetchPublicText(url, options);
  if (!fetched.ok || fetched.text === null) {
    return { ...fetched, json: null };
  }
  try {
    return { ...fetched, json: JSON.parse(fetched.text) };
  } catch {
    return {
      ...fetched,
      ok: false,
      json: null,
      error: {
        code: "PUBLIC_JSON_PARSE_FAILED",
        message: "public metadata endpoint returned non-JSON content",
        retryable: true,
      },
    };
  }
}

async function fetchPublicText(url, options = {}) {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: options.accept ?? "*/*",
      },
    });
    const text = await response.text();
    return {
      ok: response.ok,
      statusCode: response.status,
      url: response.url,
      text,
      error: response.ok
        ? null
        : {
            code: "PUBLIC_FETCH_FAILED",
            message: `public HTTP GET returned ${response.status}`,
            retryable: response.status >= 500,
          },
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      url,
      text: null,
      error: {
        code: "PUBLIC_FETCH_FAILED",
        message:
          error instanceof Error ? error.message : "public HTTP GET failed",
        retryable: true,
      },
    };
  }
}

// --- In-flight live-spend recovery breadcrumb (#1789) -----------------------
// A live create/edit is one synchronous request that can block for the full
// provider duration (often minutes). If the agent kills the process during that
// wait, the hosted API may have already reserved a credit, yet the agent is left
// with no job id, no trace, and no recovery handle — an orphaned debit it cannot
// see or reconcile (the reservation only auto-releases on a 15-minute TTL).
//
// We close that loop on the client, BEFORE the blocking request: every live
// spend carries an idempotency key, and we hand the agent that key (stderr) plus
// a durable local breadcrumb. On interruption the agent re-runs the same command
// with the same key; the hosted API replays the original job (returning the
// asset already paid for) or releases the reserved credit — never a double
// charge. See https://image-skill.com/cli.md#image-skill-create.

function liveSpendIdempotencyKey(args, operation) {
  const explicit = flagString(args, "idempotency-key");
  if (explicit !== null) {
    return explicit;
  }
  return `${operation}-${Date.now()}-${randomBytes(6).toString("hex")}`;
}

function inFlightSpendDir() {
  return join(dirname(configPath()), "in-flight");
}

function recoverCommandFor(operation, idempotencyKey) {
  return `image-skill ${operation} --idempotency-key ${idempotencyKey} <same arguments> --json`;
}

// The breadcrumb filename derives from the (possibly agent-supplied)
// idempotency key; keep it to a safe charset so a hostile or accidental key
// like "../config" can never escape the in-flight directory or collide with
// the CLI's own config file.
function inFlightSpendFileName(idempotencyKey) {
  const safe = String(idempotencyKey).replace(/[^A-Za-z0-9._-]/g, "_");
  const trimmed = safe.replace(/^\.+/, "").slice(0, 120);
  return `${trimmed.length === 0 ? "key" : trimmed}.json`;
}

async function inFlightSpendDoctorReport(input) {
  const dir = inFlightSpendDir();
  const now = input.now ?? new Date();
  const files = await readdir(dir).catch((error) => {
    if (error?.code === "ENOENT") {
      return [];
    }
    return null;
  });
  if (files === null) {
    return {
      schema: "image-skill.in-flight-spend-report.v1",
      directory: dir,
      count: null,
      recoverable_count: null,
      ttl_elapsed_count: null,
      sweep_eligible_count: null,
      invalid_count: null,
      entries: [],
      error: "in-flight directory could not be read",
      reservation_ttl_ms: IN_FLIGHT_RESERVATION_TTL_MS,
      sweep_after_ms: IN_FLIGHT_SWEEP_AFTER_MS,
      swept_count: 0,
      sweep_requested: input.sweep === true,
    };
  }

  const entries = [];
  let invalidCount = 0;
  let sweptCount = 0;
  for (const file of files.sort()) {
    if (!file.endsWith(".json")) {
      continue;
    }
    const path = join(dir, file);
    const entry = await readInFlightSpendEntry({ path, file, now });
    if (entry === null) {
      invalidCount += 1;
      continue;
    }
    if (input.sweep === true && entry.sweep_eligible === true) {
      await rm(path, { force: true }).catch(() => {});
      sweptCount += 1;
      continue;
    }
    entries.push(entry);
  }

  return {
    schema: "image-skill.in-flight-spend-report.v1",
    directory: dir,
    count: entries.length,
    recoverable_count: entries.filter((entry) => entry.state === "recoverable")
      .length,
    ttl_elapsed_count: entries.filter((entry) => entry.state === "ttl_elapsed")
      .length,
    sweep_eligible_count: entries.filter((entry) => entry.sweep_eligible)
      .length,
    invalid_count: invalidCount,
    swept_count: sweptCount,
    reservation_ttl_ms: IN_FLIGHT_RESERVATION_TTL_MS,
    sweep_after_ms: IN_FLIGHT_SWEEP_AFTER_MS,
    sweep_requested: input.sweep === true,
    entries,
    note:
      entries.length === 0
        ? "no in-flight live spend breadcrumbs found"
        : "rerun an entry's recover_command to settle or inspect a maybe-reserved spend before sweeping it",
  };
}

async function readInFlightSpendEntry({ path, file, now }) {
  let parsed;
  let fileStat;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
    fileStat = await stat(path);
  } catch {
    return null;
  }
  if (
    parsed?.schema !== "image-skill.in-flight-spend.v1" ||
    typeof parsed.idempotency_key !== "string" ||
    typeof parsed.operation !== "string"
  ) {
    return null;
  }

  const startedAt =
    typeof parsed.started_at === "string" ? parsed.started_at : null;
  const startedTime =
    startedAt === null ? Number.NaN : new Date(startedAt).getTime();
  const fallbackTime = fileStat.mtime.getTime();
  const basisTime = Number.isFinite(startedTime) ? startedTime : fallbackTime;
  const ageMs = Math.max(0, now.getTime() - basisTime);
  const state =
    ageMs >= IN_FLIGHT_RESERVATION_TTL_MS ? "ttl_elapsed" : "recoverable";
  const sweepEligible = ageMs >= IN_FLIGHT_SWEEP_AFTER_MS;
  const argv = Array.isArray(parsed.argv)
    ? parsed.argv.filter((value) => typeof value === "string")
    : [];
  const recoverCommand = renderRecoverCommand({
    operation: parsed.operation,
    argv,
    idempotencyKey: parsed.idempotency_key,
    fallback: parsed.recover_command,
  });

  return {
    file,
    path,
    operation: parsed.operation,
    command:
      typeof parsed.command === "string"
        ? parsed.command
        : `image-skill ${parsed.operation}`,
    idempotency_key: parsed.idempotency_key,
    started_at: startedAt,
    age_ms: ageMs,
    state,
    sweep_eligible: sweepEligible,
    recover_command: recoverCommand,
    original_recover_command:
      typeof parsed.recover_command === "string"
        ? parsed.recover_command
        : null,
    warning:
      state === "recoverable"
        ? "the hosted reservation TTL has not elapsed; recover before cleanup"
        : sweepEligible
          ? "reservation TTL has long elapsed; recover first if the original result still matters, or run doctor --sweep-in-flight to remove this breadcrumb"
          : "reservation TTL has elapsed; recover if you need the result, otherwise leave it until it becomes sweep-eligible",
  };
}

function renderRecoverCommand(input) {
  const argv = withRecoveryArgs(input.argv, input.idempotencyKey);
  if (argv.length === 0 && typeof input.fallback === "string") {
    return input.fallback;
  }
  return renderImageSkillCommand(input.operation, argv);
}

function withRecoveryArgs(argv, idempotencyKey) {
  const args = [...argv];
  const hasIdempotency = args.some(
    (arg) =>
      arg === "--idempotency-key" || arg.startsWith("--idempotency-key="),
  );
  if (!hasIdempotency) {
    args.push("--idempotency-key", idempotencyKey);
  }
  const hasJson = args.some((arg) => arg === "--json");
  if (!hasJson) {
    args.push("--json");
  }
  return args;
}

function renderImageSkillCommand(operation, argv) {
  return ["image-skill", operation, ...argv.map(shellQuote)].join(" ");
}

async function recordInFlightSpend(input) {
  const { command, operation, idempotencyKey, argv } = input;
  const recoverCommand = recoverCommandFor(operation, idempotencyKey);
  const note =
    "live spend may already be reserved. If this command is interrupted before it returns a result, re-run it with the idempotency_key above; the hosted API replays the original job or releases the reserved credit and never double-charges.";
  // Persist the durable breadcrumb FIRST, then announce — so by the time the
  // agent sees the stderr handle, the on-disk copy already exists (an operator
  // or a later session can find an orphaned spend even when the transcript is
  // gone).
  const dir = inFlightSpendDir();
  const path = join(dir, inFlightSpendFileName(idempotencyKey));
  let recordedPath = null;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify(
        {
          schema: "image-skill.in-flight-spend.v1",
          command,
          operation,
          idempotency_key: idempotencyKey,
          recover_command: recoverCommand,
          argv,
          started_at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    recordedPath = path;
  } catch {
    // The stderr notice below is the primary handle; a filesystem failure must
    // not block the create/edit.
  }
  // stderr only — the stdout JSON envelope contract is unchanged. Even a killed
  // process leaves this line in the agent's captured transcript.
  try {
    process.stderr.write(
      `${JSON.stringify({
        in_flight: {
          command,
          idempotency_key: idempotencyKey,
          recover_command: recoverCommand,
          note,
        },
      })}\n`,
    );
  } catch {
    // diagnostics are best-effort; never block the spend on a write failure.
  }
  return recordedPath;
}

async function clearInFlightSpend(path) {
  if (path === null || path === undefined) {
    return;
  }
  try {
    await rm(path, { force: true });
  } catch {
    // best-effort cleanup; a leftover breadcrumb is harmless.
  }
}

// Clear the breadcrumb only when the spend's fate is KNOWN: a success, or a
// non-retryable failure (4xx — the server rejected it without charging). A
// retryable failure (network reset, proxy 5xx) is exactly the
// maybe-already-debited case the breadcrumb exists for, so it must survive
// for a later session or operator to find.
async function clearInFlightSpendForResult(path, result) {
  if (path === null || path === undefined) {
    return;
  }
  const envelope = result?.envelope;
  const retryableFailure =
    envelope !== undefined &&
    envelope.ok !== true &&
    envelope.error?.retryable === true;
  if (retryableFailure) {
    return;
  }
  await clearInFlightSpend(path);
}

async function apiRequest(input) {
  const url = new URL(input.path, ensureTrailingSlash(input.apiBaseUrl));
  try {
    const response = await fetch(url, {
      method: input.method,
      headers: {
        accept: "application/json",
        ...(input.body === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...(input.token === undefined
          ? {}
          : { authorization: `Bearer ${input.token}` }),
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });
    const text = await response.text();
    const envelope = parseEnvelope(text, input.command, response.status, {
      requestBody: input.body,
    });
    const exitCodeHeader = response.headers.get("x-image-skill-exit-code");
    return {
      exitCode:
        exitCodeHeader === null
          ? envelope.ok
            ? 0
            : exitCodeForStatus(response.status)
          : Number(exitCodeHeader),
      envelope,
    };
  } catch (error) {
    // Money integrity (#1789 review): a network failure can land AFTER the
    // request was sent — a live create/edit may already have reserved a
    // credit. Echo the request's idempotency key in-band so the recovery
    // re-run dedupes to one charge instead of pointing at doctor alone.
    const recovery =
      isCreateOrEditCommand(input.command) &&
      input.body !== undefined &&
      typeof input.body.idempotency_key === "string"
        ? {
            suggested_command: `${input.command} --idempotency-key ${input.body.idempotency_key} --json`,
            idempotency_key: input.body.idempotency_key,
            docs_url: "https://image-skill.com/cli.md",
            retry_after_seconds: 30,
          }
        : {
            suggested_command: "image-skill doctor --json",
            docs_url: "https://image-skill.com/cli.md",
            retry_after_seconds: 30,
          };
    return failure(
      input.command,
      7,
      "HOSTED_API_REQUEST_FAILED",
      error instanceof Error ? error.message : "hosted API request failed",
      true,
      recovery,
    );
  }
}

function parseEnvelope(text, command, statusCode, options = {}) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && "ok" in parsed) {
      return parsed;
    }
  } catch {
    // Fall through to normalized public error.
  }
  const retryable = statusCode >= 500;
  // Money integrity (#1228): a proxy-killed 502 returns a non-JSON body, so the
  // server's own recovery guidance never reaches the agent. For a retryable
  // create/edit (which may already have debited a credit) synthesize an
  // idempotency-keyed retry command so the advertised retry dedupes to one
  // charge instead of double-charging. Echo the request's key when present;
  // otherwise mint a stable key so the NEXT retry is safe.
  const recovery =
    retryable && isCreateOrEditCommand(command)
      ? nonJsonRetryRecovery(command, options.requestBody)
      : undefined;
  return {
    ok: false,
    command,
    trace_id: traceId(),
    actor: null,
    data: null,
    warnings: retryable
      ? [
          "the hosted API may have already reserved a credit; retry with the returned idempotency_key so the retry is not double-charged",
        ]
      : [],
    error: {
      code: "HOSTED_API_NON_JSON_RESPONSE",
      message: `hosted API returned HTTP ${statusCode} without a JSON envelope`,
      retryable,
      ...(recovery === undefined ? {} : { recovery }),
    },
  };
}

function isCreateOrEditCommand(command) {
  return command === "image-skill create" || command === "image-skill edit";
}

function nonJsonRetryRecovery(command, requestBody) {
  const operation = command === "image-skill edit" ? "edit" : "create";
  const existingKey =
    requestBody &&
    typeof requestBody === "object" &&
    typeof requestBody.idempotency_key === "string"
      ? requestBody.idempotency_key
      : null;
  const idempotencyKey =
    existingKey ??
    `${operation}-retry-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const anchor =
    operation === "edit" ? "image-skill-edit" : "image-skill-create";
  return {
    suggested_command: `${command} --idempotency-key ${idempotencyKey} --json`,
    idempotency_key: idempotencyKey,
    docs_url: `https://image-skill.com/cli.md#${anchor}`,
    retry_after_seconds: 5,
  };
}

function withStripeCheckoutCopyFallback(result) {
  const data = result.envelope.data;
  if (!isRecord(data)) {
    return result;
  }

  const updated = stripeCheckoutCopyFallbackData(data);
  if (updated === data) {
    return result;
  }

  return {
    ...result,
    envelope: {
      ...result.envelope,
      data: updated,
    },
  };
}

function stripeCheckoutCopyFallbackData(data) {
  let changed = false;
  const updated = { ...data };

  if (addCheckoutCompactUrl(updated)) {
    changed = true;
  }

  if (isRecord(updated.next)) {
    const next = { ...updated.next };
    let nextChanged = addCheckoutCompactUrl(next);
    if (
      typeof updated.checkout_compact_url === "string" &&
      typeof next.checkout_compact_url !== "string"
    ) {
      next.checkout_compact_url = updated.checkout_compact_url;
      nextChanged = true;
    }
    if (nextChanged) {
      updated.next = next;
      changed = true;
    }
  }

  if (isRecord(updated.payment_attempt)) {
    const paymentAttempt = { ...updated.payment_attempt };
    if (addCheckoutCompactUrl(paymentAttempt)) {
      updated.payment_attempt = paymentAttempt;
      changed = true;
    }
    if (isRecord(updated.next)) {
      const next = { ...updated.next };
      if (
        next.human_action === "open_checkout_url" &&
        typeof paymentAttempt.checkout_compact_url === "string" &&
        typeof next.checkout_compact_url !== "string"
      ) {
        next.checkout_compact_url = paymentAttempt.checkout_compact_url;
        updated.next = next;
        changed = true;
      }
    }
  }

  return changed ? updated : data;
}

function addCheckoutCompactUrl(record) {
  const handoff =
    typeof record.checkout_handoff_url === "string"
      ? record.checkout_handoff_url
      : null;
  if (handoff !== null && handoff.length > 0) {
    let changed = false;
    if (record.checkout_compact_url !== handoff) {
      record.checkout_compact_url = handoff;
      changed = true;
    }
    return changed;
  }

  const raw =
    typeof record.checkout_url === "string"
      ? record.checkout_url
      : typeof record.fallback_checkout_url === "string"
        ? record.fallback_checkout_url
        : null;
  if (raw === null || raw.length === 0) {
    return false;
  }
  const compact = stripeCheckoutCompactUrl(raw);
  let changed = false;
  if (record.checkout_compact_url !== compact) {
    record.checkout_compact_url = compact;
    changed = true;
  }
  return changed;
}

function stripeCheckoutCompactUrl(checkoutUrl) {
  const trimmed = checkoutUrl.trim();
  if (trimmed.length === 0) {
    return checkoutUrl;
  }
  return trimmed;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function promptValue(args) {
  const prompt = flagString(args, "prompt");
  const promptFile = flagString(args, "prompt-file");
  if (prompt !== null && promptFile !== null) {
    return {
      ok: false,
      result: invalid(
        "image-skill create",
        "provide either --prompt or --prompt-file, not both",
      ),
    };
  }
  if (prompt !== null) {
    return { ok: true, value: prompt };
  }
  if (promptFile !== null) {
    return { ok: true, value: await readFile(promptFile, "utf8") };
  }
  return {
    ok: false,
    result: invalid("image-skill create", "create/edit requires --prompt"),
  };
}

async function editPromptValue(args, modelId) {
  if (args.flags.has("prompt") && flagString(args, "prompt") === null) {
    return {
      ok: false,
      result: invalid("image-skill edit", "--prompt requires a value"),
    };
  }
  if (
    args.flags.has("prompt-file") &&
    flagString(args, "prompt-file") === null
  ) {
    return {
      ok: false,
      result: invalid("image-skill edit", "--prompt-file requires a value"),
    };
  }
  const prompt = flagString(args, "prompt");
  const promptFile = flagString(args, "prompt-file");
  if (prompt !== null && promptFile !== null) {
    return {
      ok: false,
      result: invalid(
        "image-skill edit",
        "provide either --prompt or --prompt-file, not both",
      ),
    };
  }
  const isPromptlessModel =
    modelId !== null && PROMPTLESS_EDIT_MODEL_IDS.has(modelId);
  let value = null;
  if (prompt !== null) {
    value = prompt;
  } else if (promptFile !== null) {
    value = await readFile(promptFile, "utf8");
  }
  const trimmed = value?.trim() ?? "";
  if (isPromptlessModel) {
    if (trimmed.length > 0) {
      return {
        ok: false,
        result: invalid(
          "image-skill edit",
          `model ${modelId} does not accept --prompt`,
        ),
      };
    }
    return { ok: true, value: "" };
  }
  if (value === null) {
    return {
      ok: false,
      result: invalid("image-skill edit", "edit requires --prompt"),
    };
  }
  if (trimmed.length === 0) {
    return {
      ok: false,
      result: invalid("image-skill edit", "edit prompt cannot be empty"),
    };
  }
  return { ok: true, value: trimmed };
}

async function resolveToken(args, options = {}) {
  if (flagBool(args, "token-stdin")) {
    if (process.stdin.isTTY) {
      return {
        ok: false,
        result: failure(
          commandLabel(process.argv.slice(2)),
          2,
          "INVALID_ARGUMENTS",
          "--token-stdin requires a token piped on stdin",
          false,
        ),
      };
    }
    const token = (await readStdin()).trim();
    if (token.length === 0) {
      return {
        ok: false,
        result: failure(
          commandLabel(process.argv.slice(2)),
          3,
          "AUTH_REQUIRED",
          "--token-stdin received empty stdin",
          false,
        ),
      };
    }
    return { ok: true, token, source: "stdin" };
  }
  const flagToken = flagString(args, "token");
  if (flagToken !== null) {
    return { ok: true, token: flagToken, source: "flag" };
  }
  const envToken =
    process.env.IMAGE_SKILL_TOKEN ?? process.env.IMAGE_SKILL_HOSTED_TOKEN;
  if (envToken !== undefined && envToken.trim().length > 0) {
    return { ok: true, token: envToken.trim(), source: "env" };
  }
  if (options.allowSaved !== false) {
    const config = await readConfig(configPath());
    if (typeof config.token === "string" && config.token.trim().length > 0) {
      return { ok: true, token: config.token.trim(), source: "config" };
    }
  }
  if (options.allowMissing === true) {
    return { ok: true, token: null, source: "anonymous" };
  }
  return {
    ok: false,
    result: failure(
      commandLabel(process.argv.slice(2)),
      3,
      "AUTH_REQUIRED",
      "hosted command requires auth; run signup, set IMAGE_SKILL_TOKEN, or pass --token-stdin",
      false,
      {
        suggested_command: SIGNUP_SUGGESTED_COMMAND,
        docs_url: "https://image-skill.com/cli.md#image-skill-signup-agent",
      },
    ),
  };
}

async function readConfig(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return {
      ...value,
      tokenPresent:
        typeof value.token === "string" && value.token.trim().length > 0,
    };
  } catch {
    return { token: null, tokenPresent: false };
  }
}

async function saveConfig(value) {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(path, 0o600);
}

async function probeConfigWritable() {
  const path = configPath();
  const probePath = `${path}.write-test-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(probePath, "", { mode: 0o600 });
    await chmod(probePath, 0o600);
    await rm(probePath, { force: true });
    return { ok: true, path, parent_path: dirname(path) };
  } catch (error) {
    await rm(probePath, { force: true }).catch(() => {});
    return {
      ok: false,
      path,
      parent_path: dirname(path),
      error,
      message: configWriteErrorMessage(error),
    };
  }
}

async function assertConfigWritable(command) {
  const status = await probeConfigWritable();
  if (status.ok) {
    return { ok: true };
  }
  return {
    ok: false,
    result: configWriteFailure(command, status.error),
  };
}

function publicConfigWriteStatus(status, command) {
  if (status.ok) {
    return {
      writable: true,
      config_path: status.path,
      parent_path: status.parent_path,
      parent_directories_prepared: true,
      error_message: null,
      recovery: null,
    };
  }
  return {
    writable: false,
    config_path: status.path,
    parent_path: status.parent_path,
    parent_directories_prepared: false,
    error_message: status.message,
    recovery: configWriteRecovery(command),
  };
}

function configWriteErrorMessage(error) {
  return error instanceof Error
    ? error.message
    : "public CLI could not write its local auth config";
}

function configWriteRecovery(command) {
  const baseSignupCommand = renderWritableConfigCommand(
    SIGNUP_SUGGESTED_COMMAND,
  );
  if (command === "image-skill auth save") {
    return {
      config_path_env: "IMAGE_SKILL_CONFIG_PATH",
      suggested_config_path: LOCAL_WRITABLE_CONFIG_PATH,
      suggested_command: renderWritableConfigCommand(
        "image-skill auth save --json",
      ),
      docs_url: "https://image-skill.com/cli.md#local-config-and-install",
    };
  }
  return {
    config_path_env: "IMAGE_SKILL_CONFIG_PATH",
    suggested_config_path: LOCAL_WRITABLE_CONFIG_PATH,
    suggested_command: baseSignupCommand,
    fallback_command: `${SIGNUP_SUGGESTED_COMMAND} --show-token --no-save`,
    fallback_auth_method: "--token-stdin",
    docs_url: "https://image-skill.com/cli.md#local-config-and-install",
  };
}

function configWriteFailure(command, error) {
  const message = configWriteErrorMessage(error);
  return failure(
    command,
    9,
    "PUBLIC_CLI_CONFIG_WRITE_FAILED",
    `public CLI could not write auth config at ${configPath()}: ${message}`,
    true,
    configWriteRecovery(command),
  );
}

function parseArgs(argv) {
  const flags = new Map();
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item?.startsWith("--")) {
      const raw = item.slice(2);
      const equalIndex = raw.indexOf("=");
      if (equalIndex !== -1) {
        pushFlag(flags, raw.slice(0, equalIndex), raw.slice(equalIndex + 1));
        continue;
      }
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        pushFlag(flags, raw, next);
        index += 1;
      } else {
        pushFlag(flags, raw, true);
      }
    } else if (item !== undefined) {
      positionals.push(item);
    }
  }
  return { flags, positionals };
}

function pushFlag(flags, name, value) {
  const values = flags.get(name) ?? [];
  values.push(value);
  flags.set(name, values);
}

function flagString(args, name) {
  const value = args.flags.get(name)?.at(-1);
  return typeof value === "string" ? value : null;
}

function flagStrings(args, name) {
  return (args.flags.get(name) ?? []).filter(
    (value) => typeof value === "string",
  );
}

function flagBool(args, name) {
  return args.flags.has(name) && args.flags.get(name)?.at(-1) !== "false";
}

function rejectPaymentCredentialFlags(args, command) {
  for (const flag of args.flags.keys()) {
    if (PAYMENT_CREDENTIAL_FLAGS.has(flag)) {
      return failure(
        command,
        2,
        "PAYMENT_CREDENTIAL_FLAG_REJECTED",
        `public Image Skill credits commands never accept payment credential flag --${flag}`,
        false,
        {
          docs_url: "https://image-skill.com/cli.md#image-skill-credits-buy",
        },
      );
    }
  }
  return null;
}

function signupContact(args) {
  if (
    args.flags.has("agent-contact") &&
    flagString(args, "agent-contact") === null
  ) {
    return {
      ok: false,
      value: null,
      message: "agent-contact requires a value",
    };
  }
  if (
    args.flags.has("human-email") &&
    flagString(args, "human-email") === null
  ) {
    return {
      ok: false,
      value: null,
      message: "human-email requires a value",
    };
  }
  const agentContact = flagString(args, "agent-contact");
  const humanEmail = flagString(args, "human-email");
  if (agentContact !== null && humanEmail !== null) {
    const normalizedAgentContact = agentContact.trim().toLowerCase();
    const normalizedHumanEmail = humanEmail.trim().toLowerCase();
    if (normalizedAgentContact !== normalizedHumanEmail) {
      return {
        ok: false,
        value: null,
        message:
          "signup received both --agent-contact and --human-email with different values; use one durable contact inbox",
      };
    }
    return { ok: true, value: normalizedAgentContact };
  }
  const value = agentContact ?? humanEmail;
  return {
    ok: true,
    value: value === null ? null : value.trim().toLowerCase(),
  };
}

function flagNumber(args, name) {
  const value = flagString(args, name);
  if (value === null) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveIntegerFlag(args, name, input) {
  const value = flagString(args, name);
  if (value === null) {
    return { ok: true, value: null };
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    return {
      ok: false,
      result: invalid(input.command, `${name} must be a positive integer`),
    };
  }
  return { ok: true, value: number };
}

function jsonObjectFlag(args, name) {
  const raw = flagString(args, name);
  if (raw === null) {
    return { ok: true, value: null };
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return { ok: true, value: parsed };
    }
  } catch {
    // Fall through to normalized public error.
  }
  return {
    ok: false,
    result: invalid(
      commandLabel(process.argv.slice(2)),
      `--${name} must be a JSON object`,
    ),
  };
}

function csvFlag(args, name, fallback) {
  const value = flagString(args, name);
  return value === null
    ? fallback
    : value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function optionalIdempotencyKey(args, prefix) {
  const value = flagString(args, "idempotency-key");
  if (value !== null) {
    return { value, generated: false };
  }
  return {
    value: `${prefix}-${Date.now()}-${randomBytes(4).toString("hex")}`,
    generated: true,
  };
}

function requiredIdempotencyKey(args, command, message) {
  const value = flagString(args, "idempotency-key");
  if (value !== null) {
    return { ok: true, value };
  }
  return {
    ok: false,
    result: failure(command, 2, "INVALID_ARGUMENTS", message, false, {
      required_flag: "--idempotency-key",
      suggested_command: `${command} --idempotency-key KEY --json`,
      docs_url: "https://image-skill.com/cli.md#image-skill-credits",
    }),
  };
}

function addQueryFlag(query, args, flag, key) {
  const value = flagString(args, flag);
  if (value !== null) {
    query.set(key, value);
  }
}

function apiBase(args) {
  return (
    flagString(args, "api-base-url") ??
    process.env.IMAGE_SKILL_API_BASE_URL ??
    DEFAULT_API_BASE_URL
  );
}

function configPath() {
  return process.env.IMAGE_SKILL_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;
}

function hasEnvToken() {
  return Boolean(
    process.env.IMAGE_SKILL_TOKEN ?? process.env.IMAGE_SKILL_HOSTED_TOKEN,
  );
}

function success(command, data, warnings = []) {
  return {
    exitCode: 0,
    envelope: {
      ok: true,
      command,
      trace_id: traceId(),
      actor: null,
      data,
      warnings,
      error: null,
    },
  };
}

function invalid(command, message) {
  return failure(command, 2, "INVALID_ARGUMENTS", message, false, {
    docs_url: "https://image-skill.com/cli.md",
  });
}

function withCommand(result, command) {
  return {
    ...result,
    envelope: {
      ...result.envelope,
      command,
    },
  };
}

function withQuotaNextActions(
  result,
  commandPrefix = createGuideCommandPrefix(),
) {
  const data = result.envelope?.data;
  if (
    result.envelope?.ok !== true ||
    data === null ||
    typeof data !== "object"
  ) {
    return result;
  }
  const quotaData = quotaDataWithCopyRunnableTopUpCommands(data, commandPrefix);
  const nextActions = quotaTopUpNextActions(quotaData.top_up);
  if (nextActions === null) {
    return quotaData === data
      ? result
      : {
          ...result,
          envelope: {
            ...result.envelope,
            data: quotaData,
          },
        };
  }
  return {
    ...result,
    envelope: {
      ...result.envelope,
      data: {
        ...quotaData,
        next_actions: nextActions,
      },
    },
  };
}

function quotaDataWithCopyRunnableTopUpCommands(data, commandPrefix) {
  if (data.top_up === undefined || data.top_up === null) {
    return data;
  }
  const topUp = quotaTopUpWithCopyRunnableCommands(data.top_up, commandPrefix);
  return topUp === data.top_up ? data : { ...data, top_up: topUp };
}

function quotaTopUpWithCopyRunnableCommands(topUp, commandPrefix) {
  const commands = topUp.commands;
  const workflow = topUp.workflow;
  if (topUp === null || typeof topUp !== "object") {
    return topUp;
  }
  const render = (command) =>
    renderCopyRunnablePaymentCommand(commandPrefix, command);
  const renderIfString = (value) =>
    typeof value === "string" ? render(value) : value;
  return {
    ...topUp,
    first_command: renderIfString(topUp.first_command),
    quote_command: renderIfString(topUp.quote_command),
    commands:
      commands !== null && typeof commands === "object"
        ? {
            ...commands,
            inspect_methods: renderIfString(commands.inspect_methods),
            inspect_packs: renderIfString(commands.inspect_packs),
            quote: renderIfString(commands.quote),
            buy: renderIfString(commands.buy),
            status: renderIfString(commands.status),
            fallback_quote: renderIfString(commands.fallback_quote),
            fallback_buy: renderIfString(commands.fallback_buy),
          }
        : commands,
    workflow:
      workflow !== null &&
      typeof workflow === "object" &&
      Array.isArray(workflow.steps)
        ? {
            ...workflow,
            steps: workflow.steps.map((step) =>
              step !== null &&
              typeof step === "object" &&
              typeof step.command === "string"
                ? { ...step, command: render(step.command) }
                : step,
            ),
          }
        : workflow,
  };
}

function withCopyRunnableQuotaRecoveryCommands(
  result,
  commandPrefix = createGuideCommandPrefix(),
) {
  const recovery = result.envelope?.error?.recovery;
  if (
    result.envelope?.ok === true ||
    recovery === null ||
    typeof recovery !== "object" ||
    recovery.top_up === undefined ||
    recovery.top_up === null
  ) {
    return result;
  }
  return {
    ...result,
    envelope: {
      ...result.envelope,
      error: {
        ...result.envelope.error,
        recovery: quotaRecoveryWithCopyRunnableCommands(
          recovery,
          commandPrefix,
        ),
      },
    },
  };
}

function quotaRecoveryWithCopyRunnableCommands(recovery, commandPrefix) {
  const render = (command) =>
    renderCopyRunnablePaymentCommand(commandPrefix, command);
  return {
    ...recovery,
    ...(typeof recovery.suggested_command === "string"
      ? { suggested_command: render(recovery.suggested_command) }
      : {}),
    ...(Array.isArray(recovery.suggested_commands)
      ? {
          suggested_commands: recovery.suggested_commands.map((command) =>
            typeof command === "string" ? render(command) : command,
          ),
        }
      : {}),
    top_up: quotaTopUpWithCopyRunnableCommands(recovery.top_up, commandPrefix),
  };
}

function quotaTopUpNextActions(topUp) {
  const commands = topUp?.commands;
  if (
    topUp?.available !== true ||
    commands === null ||
    typeof commands !== "object" ||
    typeof commands.inspect_methods !== "string" ||
    typeof commands.inspect_packs !== "string" ||
    typeof commands.quote !== "string" ||
    typeof commands.buy !== "string" ||
    typeof commands.status !== "string" ||
    typeof commands.fallback_quote !== "string" ||
    typeof commands.fallback_buy !== "string" ||
    topUp.workflow === null ||
    typeof topUp.workflow !== "object"
  ) {
    return null;
  }

  return {
    self_fund: {
      purpose: "open_browserless_top_up_path",
      available: true,
      recommended: topUp.recommended === true,
      recommendation_reason: topUp.recommendation_reason ?? "available",
      ...quotaTopUpUrgencyFields(topUp),
      path: topUp.path,
      first_safe_command: commands.inspect_methods,
      first_safe_command_effect: {
        label: "inspect_payment_methods_no_spend",
        no_spend: true,
        live_money: false,
        provider_call: false,
        hosted_create: false,
        payment_object: false,
        credit_debit: false,
        media_write: false,
      },
      inspect_methods_command: commands.inspect_methods,
      inspect_packs_command: commands.inspect_packs,
      quote_command: commands.quote,
      quote_command_copy_runnable: true,
      quote_idempotency_key_source: "public_cli_generated_if_missing",
      buy_command: commands.buy,
      status_command: commands.status,
      fallback_quote_command: commands.fallback_quote,
      fallback_buy_command: commands.fallback_buy,
      live_money: true,
      payment_method: topUp.preferred_payment_method,
      workflow: topUp.workflow,
      warning:
        "Start with first_safe_command; it is read-only and no-spend. Quote only creates a payment object. Buy/status and wallet settlement require delegated spend authority.",
    },
  };
}

function quotaTopUpUrgencyFields(topUp) {
  const reason = topUp?.recommendation_reason ?? "available";
  const fallback = quotaTopUpUrgencyFromReason(reason);
  const urgency =
    typeof topUp?.urgency === "string" && topUp.urgency.length > 0
      ? topUp.urgency
      : fallback.urgency;
  const urgencyScore =
    typeof topUp?.urgency_score === "number"
      ? topUp.urgency_score
      : fallback.score;
  const urgencyReasons = Array.isArray(topUp?.urgency_reasons)
    ? topUp.urgency_reasons
        .filter((entry) => typeof entry === "string" && entry.length > 0)
        .map((entry) => entry)
    : reason === "available"
      ? []
      : [reason];
  return {
    urgency,
    urgency_score: urgencyScore,
    urgency_reasons: urgencyReasons,
  };
}

function quotaTopUpUrgencyFromReason(reason) {
  if (reason === "credits_depleted" || reason === "daily_job_cap_reached") {
    return { urgency: "blocked", score: 100 };
  }
  if (reason === "low_remaining_credits") {
    return { urgency: "near_wall", score: 80 };
  }
  if (reason === "self_fund_setup_missing") {
    return { urgency: "setup_recommended", score: 60 };
  }
  return { urgency: "available", score: 0 };
}

function failure(command, exitCode, code, message, retryable, recovery) {
  return {
    exitCode,
    envelope: {
      ok: false,
      command,
      trace_id: traceId(),
      actor: null,
      data: null,
      warnings: [],
      error: {
        code,
        message,
        retryable,
        ...(recovery === undefined ? {} : { recovery }),
      },
    },
  };
}

function commandLabel(commandArgv) {
  return commandArgv.length === 0
    ? "image-skill"
    : `image-skill ${commandArgv[0]}`;
}

function traceId() {
  return `trace_${randomBytes(8).toString("hex")}`;
}

function exitCodeForStatus(status) {
  if (status === 401 || status === 403) {
    return 3;
  }
  if (status === 402 || status === 429) {
    return 5;
  }
  if (status >= 500) {
    return 7;
  }
  return 1;
}

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function readStdin() {
  return new Promise((resolvePromise, reject) => {
    let value = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      value += chunk;
    });
    process.stdin.on("error", reject);
    process.stdin.on("end", () => resolvePromise(value));
  });
}

function assetIdFromReference(reference) {
  if (isAssetId(reference)) {
    return reference;
  }
  try {
    const url = new URL(reference);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "media.image-skill.com" ||
      !url.pathname.startsWith("/a/")
    ) {
      return null;
    }
    const candidate = basename(url.pathname).replace(/\.[a-z0-9]+$/i, "");
    return isAssetId(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function isAssetId(value) {
  return /^(?:asset|image|video|audio|mask|thumb|file)_[a-zA-Z0-9._-]{1,128}$/.test(
    value,
  );
}

function deriveAssetGetOutputPath(asset) {
  const urlBasename = safeUsefulUrlBasename(asset.url);
  if (urlBasename !== null) {
    return urlBasename;
  }
  const assetId =
    typeof asset.asset_id === "string" &&
    isSafeDerivedAssetFilename(asset.asset_id)
      ? asset.asset_id
      : (assetIdFromReference(asset.url) ?? "asset");
  return `${assetId}${assetOutputExtension(asset)}`;
}

function safeUsefulUrlBasename(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const rawBasename = basename(url.pathname);
  if (rawBasename.length === 0) {
    return null;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(rawBasename);
  } catch {
    return null;
  }
  if (!isSafeDerivedAssetFilename(decoded)) {
    return null;
  }
  return extname(decoded).length > 0 ? decoded : null;
}

function isSafeDerivedAssetFilename(value) {
  return (
    value.length > 0 &&
    value.length <= 220 &&
    value !== "." &&
    value !== ".." &&
    !value.startsWith(".") &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
  );
}

function assetOutputExtension(asset) {
  const mimeType =
    typeof asset.mime_type === "string"
      ? asset.mime_type.split(";")[0].trim().toLowerCase()
      : null;
  if (mimeType === "image/png") {
    return ".png";
  }
  if (mimeType === "image/jpeg") {
    return ".jpg";
  }
  if (mimeType === "image/webp") {
    return ".webp";
  }
  if (mimeType === "image/gif") {
    return ".gif";
  }
  if (mimeType === "image/avif") {
    return ".avif";
  }
  return safeUrlExtension(asset.url) ?? "";
}

function safeUrlExtension(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const rawBasename = basename(url.pathname);
  if (rawBasename.length === 0) {
    return null;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(rawBasename);
  } catch {
    return null;
  }
  const extension = extname(decoded).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : "";
}

async function downloadUrl(url, outputPath, options) {
  if (!options.overwrite && (await fileExists(outputPath))) {
    return {
      ok: false,
      result: failure(
        "image-skill assets get",
        9,
        "OUTPUT_EXISTS",
        `output path already exists: ${outputPath}`,
        false,
      ),
    };
  }
  const response = await fetch(url);
  if (!response.ok || response.body === null) {
    return {
      ok: false,
      result: failure(
        "image-skill assets get",
        7,
        "ASSET_DOWNLOAD_FAILED",
        `asset download failed: HTTP ${response.status}`,
        true,
      ),
    };
  }
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(outputPath),
  );
  const file = await stat(outputPath);
  return {
    ok: true,
    data: {
      output_path: outputPath,
      bytes: file.size,
      content_type: response.headers.get("content-type"),
      content_length_header:
        response.headers.get("content-length") === null
          ? null
          : Number(response.headers.get("content-length")),
      overwritten: options.overwrite,
    },
  };
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function mimeFromFilename(filename) {
  const ext = extname(filename).toLowerCase();
  if (ext === ".png") {
    return "image/png";
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  if (ext === ".gif") {
    return "image/gif";
  }
  if (ext === ".avif") {
    return "image/avif";
  }
  return null;
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}
