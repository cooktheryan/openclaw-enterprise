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

An authorized Agent can use one GitLab.com project for the same repository tasks and access profiles OCE supports for GitHub, through the Repo capability. GitLab credentials stay in the service. Self-managed GitLab and human-delegated tokens are outside the proposed first release.

Preserve task parity for `git-read` (clone/fetch; inspect project, issues, merge requests, diffs, and pipeline status), `git-write` (read tasks plus branch push and draft merge-request creation/discussion), and `git-full` (write tasks plus issue creation and comments). Keep issue writes disabled in `git-write`. Create merge requests from already-pushed branches with explicit source and target branches; do not add implicit push or fork behavior. Provider-specific command names can differ, but the Agent must not gain merge, approval, project administration, or pipeline-control operations.

The RFC proposes a project service account and draft merge-request creation. GitLab service accounts can hold fine-grained PATs, and GitLab documents project permissions for Git and merge-request API operations. The project service-account token endpoint documents coarse scopes; fine-grained token creation for the current user is an experimental GraphQL mutation. Validate an acceptable credential setup and rotation path before implementation.

## Contract and source touchpoints

Main currently composes only GitHubRepoDriver in [repository credential composition](../../apps/controller/src/composition/repository-credentials/platform.ts). The [Repo contract](../../packages/contracts/src/repo.ts) returns GitHub-specific files, and the [credential reference](../../docs/reference/repository-credentials.md) describes GitHub App grants. The [team runbook](../../docs/guides/repository-credentials/team-runbook.md) owns operator setup.

The work must extend the existing Repo capability and compose the provider through the installation's selected Driver. It must also reconcile the proposed GitLab path with the [Credential Proxy proposal in PR #2484](https://github.com/openclaw/openclaw-enterprise/pull/2484) before changing the Driver contract or credential lifecycle. That proposal and its [implementation PR #2487](https://github.com/openclaw/openclaw-enterprise/pull/2487) are not main behavior.

## Implementation

1. Validate a supported GitLab.com project-service-account flow for creating a fine-grained PAT with project-bound Git and merge-request permissions. Decide whether the experimental GraphQL creation path is acceptable or whether a non-experimental flow is required. Confirm that rotation preserves grants and account for GitLab revoking the old token when it issues the replacement. Resolve the project role, exact API operations, Free-tier service-account quota, and single-provider-per-Installation choice through RFC review. Confirm how the credential fits static material, expiry, revocation, and operator rotation in the final Credential Proxy and Token Service contracts.
2. Extend the Repo contract only as approved by the RFC. Add GitLab project identity and provider-specific client configuration without accepting Agent-supplied hosts or project IDs. Register and compose GitLabRepoDriver through normal Installation configuration.
3. Add the GitLab service-side provider client. Bind requests to the configured project ID and canonical path, fix HTTPS origin to gitlab.com, enforce the approved Git methods and API route/method set, and keep the upstream token outside Agent files and logs.
4. Connect GitLab project discovery and binding to the existing repository-selection caller. Preserve fail-closed behavior when the provider, token, project, or operation is unavailable or unauthorized. Keep GitHub selection working.
5. Update the repository credential reference, team runbook, runtime flow, and documentation navigation if page placement changes. State GitLab.com scope, token setup, access limits, expiry, rotation, and recovery.
6. Verify the end-to-end Agent workflow against an authorized disposable GitLab.com project. Do not treat a provider client unit test or hand-written adapter as proof of the Agent workflow.

Do not implement a new repository broker as a shortcut if PR #2484 selects the protected request path. If that proposal is rejected or changes, revise this plan and the GitLab RFC before implementation.

## Verification

| Required outcome                                                                                         | Real check and prerequisites                                                        | Result or remaining proof                                              |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Agent uses only the bound GitLab project for allowed clone, fetch, and push operations                   | Real Agent workflow with an authorized GitLab.com project and approved token        | Not run; this spike compared published docs and repository source only |
| `git-read` and `git-write` match GitHub's read and branch/MR tasks, with issues read-only in `git-write` | Real Agent workflow; verify per-profile Git, API, and denied write effects          | Not run; API route set remains for RFC review                          |
| `git-full` adds the same supported issue creation and comment tasks as GitHub                            | Same Agent workflow; verify project issue effects                                   | Not run; API route set remains for RFC review                          |
| Draft merge request can be created while merge and approval remain denied                                | Same Agent workflow; verify real GitLab API effects                                 | Not run; API route set remains for RFC review                          |
| Wrong-project, unapproved API route, and missing, expired, or revoked credentials fail closed            | Real provider responses plus OCE authorization and audit evidence                   | Not run                                                                |
| Token remains outside Agent material, logs, and client configuration                                     | Inspect delivered files, service logs, and provider request path in the integration | Not run                                                                |
| GitHub behavior remains available and existing Agent bindings retain their behavior                      | Current Repo Driver integration coverage plus targeted regression evidence          | Not run                                                                |

## Open decisions

- Product maintainers must confirm the project-service-account token creation path, exact Git/API grants, and whether GitLab.com Free support is required. This blocks the runbook and provider configuration.
- Credential Proxy maintainers must decide how a project-service-account PAT enters the final Token Service and how expiry, granular-scope preservation, immediate token replacement, and failed updates affect active bindings.
- Repo Driver maintainers must confirm the exact GitLab API operations and whether one Installation can select both GitHub and GitLab.
- An authorized GitLab.com project and project-service-account credentials are required to validate token creation, granular permissions, and the live integration workflow.

## Delivery record

No implementation has started. This plan records the proposed work and verification only.

## Manual Notes

[keep this for the user to add notes. do not change between edits]

## Changelog

- 2026-10-21: Created from main commit 90e8ac917dcfd3925a5bf9cfa4243d1459e39c84 after GitLab.com documentation research.
