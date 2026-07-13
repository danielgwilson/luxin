# Contributing

This repository (`danielgwilson/luxin`) is the public, inspectable
mirror of the `luxin` npm package and agent skill. The executable
authority is the npm package; this mirror exists so agents and reviewers can
read the source and contracts that back a published version.

## How To Help

- **File feedback from the CLI.** The most useful contribution is structured
  feedback when Luxin is missing a model or capability you needed:

  ```bash
  npm_config_update_notifier=false npx -y luxin-cli@latest feedback --json
  ```

  Include the npm version, the command you ran, and a trace ID if one was
  returned.

- **Report bugs or contract drift.** Open an issue with the npm version, the
  exact command, the observed output, and what you expected. If npm metadata,
  the mirror source, and the hosted contract disagree, say so explicitly.

- **Security issues** should be reported privately per [SECURITY.md](SECURITY.md),
  not in a public issue.

## Pull Requests

This mirror is generated from an upstream source. Small, well-scoped PRs
(typos, docs clarifications) are welcome, but larger changes may be redirected
upstream. Keep changes minimal and reviewer-friendly, and do not introduce
third-party dependencies — the package is intentionally dependency-free and
built on Node.js built-ins only.

By contributing you agree your contribution is licensed under the project's
MIT license.
