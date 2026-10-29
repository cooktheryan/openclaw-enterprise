---
rfc: ../rfcs/0024-agent-author-role.md
---

# Implementation plan: Optional Namespace Agent author role

- **ID:** RFC-0024
- **Delivery status:** In progress
- **Owner:** OpenClaw Enterprise IAM
- **Authority:** [RFC-0024](../rfcs/0024-agent-author-role.md)
- **Source baseline:** `ddbec473f0d0f906c71677ea8c95b63f8d59de86`

## Outcome and scope

An Installation administrator can assign the managed Agent Author Role to a human Principal in one Namespace. That user can sign in to the existing OCC Console and create and manage Agents and the selected supporting resources in that Namespace without Installation administration. No user receives the Role by default. This MVP uses the current editable Configuration workflow; template-only enforcement needs a separate server-side contract. The Role's exact permissions and limits are defined by [RFC-0024](../rfcs/0024-agent-author-role.md).

## Contract and source touchpoints

Current policy writes are owned by the selected IAM Driver and State transaction. Namespace policy APIs require Installation `administer`, exact Namespace `read`, and target `read`; they currently accept only exact-resource bindings and reject `create` Roles. Agent creation authorizes `agent:create` against its Namespace collection and separately checks Configuration, Secret, credential-source, and ServiceAccount references. The main owners are `packages/occ/src/index.ts`, `packages/contracts/src/api/`, `apps/controller/src/http/iam.ts`, and the IAM CLI. The source-backed request and policy flows are [Agent provisioning](../../docs/flows/agent-provisioning.md) and [Namespace IAM policy](../../docs/flows/namespace-iam-policy.md).

## Implementation

1. Submit RFC-0024 before the first implementation change. Add the managed Role and Namespace-binding inputs to the API and CLI. Restrict Namespace-wide assignment to the managed preset and verified human Principals; keep arbitrary custom Roles and Groups on the current exact-resource contract. Keep administrator authorization, transaction guards, and mutation audit intact.
2. Apply the RFC's fixed permission set through the selected IAM Driver. Preserve default deny and Restriction precedence. During Agent create, Agent update, and Configuration update, verify the author's permission on each bound credential and transactionally reconcile exact `operate` grants for that Agent ServicePrincipal; remove only these generated bindings when no longer needed. Hold and recheck the assigning session through resource writes, credential grants, and audit commit. Fail closed when the selected Driver cannot participate in the policy transaction.
3. Extend the regular Agent workflow integration for an assigned user. Add policy cases for no binding, cross-Namespace requests, unsupported custom Namespace grants, account/service-account limits, source grant isolation, revocation, and transactional failure. Register any new workflow in the QA matrix and CI selection as required. Update authorization, the permissions cheat sheet, the IAM and Agent flows, operator/user guidance, and API/CLI references. Keep the feature cloud-neutral.
4. After local proof passes, run the same create/configure/deploy/stop/log/delete scenario against the configured disposable `oce-demo` AWS host. Use it only as a Kubernetes validation environment; add no AWS IAM policy, product behavior, or application settings. Close demo resources, stop the instance after validation, and record exact proof limits.

## Verification

| Required outcome                                                      | Real check and prerequisites                                                                                   | Result or remaining proof                                                                                                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Managed Role assignment is explicit, audited, and Namespace-scoped    | `node --test tests/integration/postgres-namespace-iam-policy.test.mjs` with a disposable PostgreSQL database   | Passed: 17/17 on AWS host at feature PR head `0459f99245896167657d5965a4941ab1250045e1`                                                                                   |
| Default-deny, cross-Namespace, and restricted requests remain denied  | IAM conformance and Console API/browser suites                                                                 | Passed: 72/72 on AWS host at feature PR head `0459f99245896167657d5965a4941ab1250045e1`                                                                                   |
| Assigned user completes the Agent workflow                            | IAM conformance, Console API and browser checks; then the real Kubernetes Agent workflow with enforcing k3d    | IAM, Console API, and Agent-create browser checks passed 72/72; device-login browser checks passed 5/5. Kubernetes workflow not run: the AWS host had no kubeconfig or authorized Codex test token |
| Agent ServicePrincipal receives only exact selected credential grants | PostgreSQL policy and Console API integration                                                                  | Passed in the PostgreSQL and API suites                                                                                                                                   |
| Agent Author session remains valid through resource and grant commit  | `tests/integration/postgres-production-wireup.test.mjs` with a fresh PostgreSQL database                       | Pre-fix handlers at `0459f99245896167657d5965a4941ab1250045e1` failed the cross-replica logout wait; fixed handlers passed 7/7 at `ee18d5479bf72979b2a04049a4036ef7d181ea30` on the AWS development host |
| AWS host exercises the real Kubernetes flow                           | Configured `oce-demo` host with kubeconfig and authorized Codex test credentials                              | Not run; the host had no kubeconfig or readable Codex test token file                                                                                                     |
| API, CLI, docs and workspace contracts remain valid                   | `pnpm openapi:check`, `pnpm cli:check`, `pnpm check:workspace`, CI selection audit, formatting and docs checks | Contract checks passed; docs check blocked by missing `@sindresorhus/slugify`                                                                                             |

## Delivery record

RFC PR [#4045](https://github.com/openclaw/openclaw-enterprise/pull/4045) was submitted before implementation. The initial implementation commit is `5825fa4c068a575317dfc319128931b378bdbf75`; the current feature PR head is `0459f99245896167657d5965a4941ab1250045e1`. At that head, PostgreSQL policy integration passed 17/17 and IAM conformance, Console API, and Console browser checks passed 72/72 on the AWS development host. OpenAPI, CLI, workspace-boundary, CI selection audit, and formatting checks passed. The Storybook walkthrough shows the Agent Author creation path with simulated API and runtime state.

The real Kubernetes Agent workflow did not run because an authorized service-account token was unavailable. Storybook does not prove Kubernetes execution. `pnpm docs:check` could not run because `@sindresorhus/slugify` is missing from the installed dependency graph; no dependencies were installed. Complete the required real Kubernetes workflow and documentation checks before marking delivery complete.

The session-retention follow-up is at feature PR head `ee18d5479bf72979b2a04049a4036ef7d181ea30`. At that head, the PostgreSQL production wire-up passed 7/7, including cross-replica logout during a blocked Configuration update. The same regression failed against the pre-fix HTTP handlers at `0459f99245896167657d5965a4941ab1250045e1`: logout completed instead of waiting for the assigning session hold. IAM conformance, Console API, and Agent-create browser checks passed 72/72; device-login browser checks passed 5/5; and `pnpm typecheck` and `pnpm lint` passed. `pnpm docs:check` remains blocked because `@sindresorhus/slugify` is not installed. The real Kubernetes Agent workflow remains unrun because the AWS host has no kubeconfig or authorized Codex test token.

## Manual Notes

## Changelog

- 2026-10-29: Create the implementation plan from current IAM and Agent lifecycle contracts (ddbec473f0d0f906c71677ea8c95b63f8d59de86).
- 2026-10-29: Record implementation and AWS verification evidence at `5825fa4c068a575317dfc319128931b378bdbf75`; retain the real Kubernetes workflow and documentation checks as open proof.
- 2026-10-29: Rerun database, browser, API, contract, workspace, CI selection, and formatting checks at feature PR head `0459f99245896167657d5965a4941ab1250045e1`.
- 2026-10-29: Require assigning-session retention for Agent credential changes and record pre-fix failure and PostgreSQL/browser evidence at feature PR head `ee18d5479bf72979b2a04049a4036ef7d181ea30`.
