---
rfc: ../rfcs/0023-gitlab-repository-credentials.md
---

# Implementation plan: GitLab.com repository credentials

- **ID:** RFC-0023
- **Delivery status:** Planned
- **Owner:** Repository credential and Repo Driver maintainers
- **Authority:** [RFC-0023](../rfcs/0023-gitlab-repository-credentials.md)
- **Source baseline:** 90e8ac917dcfd3925a5bf9cfa4243d1459e39c84

## Outcome and scope

An authorized Agent can use one GitLab.com project for the approved repository workflow through the Repo capability. GitLab credentials stay in the service. Self-managed GitLab and human-delegated tokens are outside the proposed first release.

The RFC proposes a project service account and draft merge-request creation. Maintainers must resolve its open token-scope and provider-selection decisions before those choices become implementation requirements.

## Contract and source touchpoints

Main currently composes only GitHubRepoDriver in [repository credential composition](../../apps/controller/src/composition/repository-credentials/platform.ts). The [Repo contract](../../packages/contracts/src/repo.ts) returns GitHub-specific files, and the [credential reference](../../docs/reference/repository-credentials.md) describes GitHub App grants. The [team runbook](../../docs/guides/repository-credentials/team-runbook.md) owns operator setup.

The work must extend the existing Repo capability and compose the provider through the installation's selected Driver. It must also reconcile the proposed GitLab path with the [Credential Proxy proposal in PR #2484](https://github.com/openclaw/openclaw-enterprise/pull/2484) before changing the Driver contract or credential lifecycle. That proposal and its [implementation PR #2487](https://github.com/openclaw/openclaw-enterprise/pull/2487) are not main behavior.

## Implementation

1. Resolve the GitLab.com credential model, project role, scopes, Free-tier requirement, merge-request operations, and single-provider-per-Installation choice through RFC review. Confirm how the selected model fits static material, expiry, revocation, and operator rotation in the final Credential Proxy and Token Service contracts.
2. Extend the Repo contract only as approved by the RFC. Add GitLab project identity and provider-specific client configuration without accepting Agent-supplied hosts or project IDs. Register and compose GitLabRepoDriver through normal Installation configuration.
3. Add the GitLab service-side provider client. Bind requests to the configured project ID and canonical path, fix HTTPS origin to gitlab.com, enforce the approved Git methods and API route/method set, and keep the upstream token outside Agent files and logs.
4. Connect GitLab project discovery and binding to the existing repository-selection caller. Preserve fail-closed behavior when the provider, token, project, or operation is unavailable or unauthorized. Keep GitHub selection working.
5. Update the repository credential reference, team runbook, runtime flow, and documentation navigation if page placement changes. State GitLab.com scope, token setup, access limits, expiry, rotation, and recovery.
6. Verify the end-to-end Agent workflow against an authorized disposable GitLab.com project. Do not treat a provider client unit test or hand-written adapter as proof of the Agent workflow.

Do not implement a new repository broker as a shortcut if PR #2484 selects the protected request path. If that proposal is rejected or changes, revise this plan and the GitLab RFC before implementation.

## Verification

| Required outcome                                                                              | Real check and prerequisites                                                        | Result or remaining proof                                       |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Agent uses only the bound GitLab project for allowed clone, fetch, and push operations        | Real Agent workflow with a disposable GitLab.com project and approved token         | Not run; no GitLab account/project was available for this spike |
| Draft merge request can be created while merge and approval remain denied                     | Same Agent workflow; verify real GitLab API effects                                 | Not run; API route set remains for RFC review                   |
| Wrong-project, unapproved API route, and missing, expired, or revoked credentials fail closed | Real provider responses plus OCE authorization and audit evidence                   | Not run                                                         |
| Token remains outside Agent material, logs, and client configuration                          | Inspect delivered files, service logs, and provider request path in the integration | Not run                                                         |
| GitHub behavior remains available and existing Agent bindings retain their behavior           | Current Repo Driver integration coverage plus targeted regression evidence          | Not run                                                         |

## Open decisions

- Product maintainers must select a token model and decide whether GitLab.com Free support is required. This blocks the runbook and provider configuration.
- Credential Proxy maintainers must decide how a static project service-account token enters the final Token Service and how expiry and replacement affect active bindings.
- Repo Driver maintainers must confirm the exact GitLab API operations and whether one Installation can select both GitHub and GitLab.
- An authorized disposable GitLab.com project and service-account credentials are required for live integration proof.

## Delivery record

No implementation has started. This plan records the proposed work and verification only.

## Manual Notes

[keep this for the user to add notes. do not change between edits]

## Changelog

- 2026-10-21: Created from main commit 90e8ac917dcfd3925a5bf9cfa4243d1459e39c84 after GitLab.com documentation research.
