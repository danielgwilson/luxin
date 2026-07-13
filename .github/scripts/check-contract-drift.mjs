#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());
const manifestFile = "PUBLIC_CONTRACT_MANIFEST.json";
const manifestSchema = "image-skill.public-contract-manifest.v1";
const requiredContracts = [
  {
    source_path: "docs/public-contract/skill.md",
    public_paths: ["SKILL.md", "skill.md", "skills/luxin/SKILL.md"],
  },
  {
    source_path: "docs/public-contract/cli.md",
    public_paths: ["cli.md", "skills/luxin/references/cli.md"],
  },
  {
    source_path: "docs/public-contract/llms.txt",
    public_paths: ["llms.txt", "skills/luxin/references/llms.txt"],
  },
  {
    source_path: "docs/public-contract/commands.json",
    public_paths: ["commands.json", "skills/luxin/references/commands.json"],
  },
];

const problems = [];

const manifest = await readJson(manifestFile);
const packageManifest = await readJson("package.json");

if (manifest.schema !== manifestSchema) {
  problems.push(`manifest schema must be ${manifestSchema}`);
}
if (manifest.source_repo !== "danielgwilson/luxin-labs") {
  problems.push("manifest source_repo must be danielgwilson/luxin-labs");
}
if (manifest.source_root !== "docs/public-contract") {
  problems.push("manifest source_root must be docs/public-contract");
}
if (manifest.public_repo !== "danielgwilson/luxin") {
  problems.push("manifest public_repo must be danielgwilson/luxin");
}
if (manifest.package_name !== packageManifest.name) {
  problems.push("manifest package_name must match package.json");
}
if (manifest.package_version !== packageManifest.version) {
  problems.push("manifest package_version must match package.json");
}

const cliSource = await readText("bin/luxin.mjs");
const cliVersion = cliSource.match(/const VERSION = "([^"]+)";/)?.[1];
if (cliVersion !== packageManifest.version) {
  problems.push(
    `bin/luxin.mjs VERSION must match package.json version ${packageManifest.version}; saw ${cliVersion ?? "<missing>"}`,
  );
}

const entries = new Map(
  Array.isArray(manifest.files)
    ? manifest.files.map((entry) => [entry.source_path, entry])
    : [],
);

for (const expected of requiredContracts) {
  const entry = entries.get(expected.source_path);
  if (!entry) {
    problems.push(`manifest missing ${expected.source_path}`);
    continue;
  }
  if (!Array.isArray(entry.public_paths)) {
    problems.push(`${expected.source_path} public_paths must be an array`);
    continue;
  }
  for (const publicPath of expected.public_paths) {
    if (!entry.public_paths.includes(publicPath)) {
      problems.push(
        `${expected.source_path} manifest paths must include ${publicPath}`,
      );
      continue;
    }
    await validateManifestHash({
      publicPath,
      expectedBytes: entry.bytes,
      expectedSha256: entry.sha256,
    });
  }
}

run("npm", ["pack", "--dry-run", "--json"]);

if (problems.length > 0) {
  console.error(
    [
      "Public contract drift check failed.",
      "",
      ...problems.map((problem) => `- ${problem}`),
      "",
      "Regenerate this repository from the private luxin public export instead of editing mirrored contract files by hand.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      schema: manifest.schema,
      package: `${packageManifest.name}@${packageManifest.version}`,
      checked_files: requiredContracts.flatMap((entry) => entry.public_paths)
        .length,
    },
    null,
    2,
  ),
);

async function validateManifestHash({
  publicPath,
  expectedBytes,
  expectedSha256,
}) {
  const bytes = await readBytes(publicPath);
  if (bytes.byteLength !== expectedBytes) {
    problems.push(
      `${publicPath} byte length must be ${expectedBytes}; saw ${bytes.byteLength}`,
    );
  }
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== expectedSha256) {
    problems.push(
      `${publicPath} sha256 must be ${expectedSha256}; saw ${actualSha256}`,
    );
  }
}

async function readJson(path) {
  return JSON.parse(await readText(path));
}

async function readText(path) {
  return readFile(join(root, path), "utf8");
}

async function readBytes(path) {
  return readFile(join(root, path));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function run(command, args) {
  const child = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (child.status !== 0) {
    problems.push(
      `${command} ${args.join(" ")} failed: ${(child.stderr || child.stdout).trim()}`,
    );
  }
}
