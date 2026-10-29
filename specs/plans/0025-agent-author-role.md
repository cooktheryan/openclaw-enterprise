---
rfc: ../rfcs/0025-agent-author-role.md
---

# Implementation plan: Optional Namespace Agent author role

- **ID:** RFC-0025
- **Delivery status:** Planned
- **Owner:** OpenClaw Enterprise IAM
- **Authority:** [RFC-0025](../rfcs/0025-agent-author-role.md)
- **Source baseline:** `ddbec473f0d0f906c71677ea8c95b63f8d59de86`

## Outcome and scope

An Installation administrator can assign the managed Agent Author Role to a human Principal in one Namespace. That user can sign in to the existing OCC Console and create and manage Agents and the selected supporting resources in that Namespace without Installation administration. No user receives the Role by default. This MVP uses the current editable Configuration workflow; template-only enforcement needs a separate server-side contract. The Role's exact permissions and limits are defined by [RFC-0025](../rfcs/0025-agent-author-role.md).

## Contract and source touchpoints

Current policy writes are owned by the selected IAM Driver and State transaction. Namespace policy APIs require Installation `administer`, exact Namespace `read`, and target `read`; they currently accept only exact-resource bindings and reject `create` Roles. Agent creation authorizes `agent:create` against its Namespace collection and separately checks Configuration, Secret, credential-source, and ServiceAccount references. The main owners are `packages/occ/src/index.ts`, `packages/contracts/src/api/`, `apps/controller/src/http/iam.ts`, and the IAM CLI. The source-backed request and policy flows are [Agent provisioning](../../docs/flows/agent-provisioning.md) and [Namespace IAM policy](../../docs/flows/namespace-iam-policy.md).

## Implementation

1. Submit RFC-0025 alone for review before code. Add `POST .../iam/roles` preset input `{preset:"agent-author"}` and `POST .../iam/access-bindings` Namespace-scope input `{subjectKind:"identity",subjectId,roleId,scope:"namespace"}` to the API and CLI. The canonical Role ID is `role_<namespaceId>_agent_author`. Extend the IAM Driver identity lookup contract to resolve a Principal by immutable ID, and its transactional binding contract to create an untargeted Namespace binding. Restrict this scope to that immutable preset and resolved human Principals; keep arbitrary custom Roles and Groups on the current exact-resource contract. Keep administrator authorization, transaction guards, and mutation audit intact.
2. Apply the RFC's fixed permission set through the selected IAM Driver. Preserve default deny and Restriction precedence. In the Agent create/update/deploy lifecycle, verify the author's permission on each bound credential and transactionally reconcile exact `operate` grants for that Agent ServicePrincipal; remove only these generated bindings when no longer needed. Fail closed when the selected Driver cannot participate in the policy transaction.
3. Extend the regular Agent workflow integration for an assigned user. Add policy cases for no binding, cross-Namespace requests, unsupported custom Namespace grants, account/service-account limits, source grant isolation, revocation, and transactional failure. Register any new workflow in the QA matrix and CI selection as required. Update authorization, the permissions cheat sheet, the IAM and Agent flows, operator/user guidance, and API/CLI references. Keep the feature cloud-neutral.
4. After local proof passes, run the same create/configure/deploy/stop/log/delete scenario against the configured disposable `oce-demo` AWS host. Use it only as a Kubernetes validation environment; add no AWS IAM policy, product behavior, or application settings. Close demo resources, stop the instance after validation, and record exact proof limits.

## Verification

| Required outcome                                                         | Real check and prerequisites                                                                                           | Result or remaining proof |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Managed Role assignment is explicit, audited, and Namespace-scoped       | PostgreSQL API integration with real human sessions, selected IAM Driver, and State transaction                        | Not run                   |
| Unassigned, cross-Namespace, or restricted operations remain denied      | Same API integration; prove default deny and Restriction precedence                                                    | Not run                   |
| Assigned user creates supporting resources and completes Agent lifecycle | Existing real Kubernetes Agent workflow with disposable enforcing k3d and dedicated migrated `openclaw_k8s_*` database | Not run                   |
| Agent ServicePrincipal receives only exact selected credential grants    | PostgreSQL-backed create/update/deploy/delete integration; inspect resulting IAM policy through supported API          | Not run                   |
| AWS host exercises the cloud-neutral flow and leaves no instance running | Configured `oce-demo` host with real cluster workflow and required local runtime/model inputs                          | Not run                   |
| API, CLI, docs and workspace contracts remain valid                      | `pnpm openapi:check`, `pnpm cli:check`, focused tests, `pnpm docs:check`, `pnpm check:workspace`, formatting and lint  | Not run                   |

## Delivery record

RFC-only submission must precede the first implementation change. Update this record with the RFC PR, implementation PR, exact commands/results, AWS instance cleanup, and remaining proof after each milestone.

## Manual Notes

## Changelog

- 2026-10-29: Create the implementation plan from current IAM and Agent lifecycle contracts (ddbec473f0d0f906c71677ea8c95b63f8d59de86).
