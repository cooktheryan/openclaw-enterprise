---
status: Proposed
implementation_status: Not implemented
author: cooktheryan
---

# Proposal: Optional Namespace Agent author role

- **ID:** RFC-0024
- **Created:** 2026-10-29
- **Last updated:** 2026-10-29
- **RFC PR:** [#4045](https://github.com/openclaw/openclaw-enterprise/pull/4045)
- **Implementation plan:** [RFC-0024 implementation plan](../plans/0024-agent-author-role.md)
- **Related:** [Authorization](../../docs/reference/authorization.md), [RFC-0006](0006-basic-rbac/index.md)

## Summary

Add an optional, fixed **Agent Author** Role. An Installation administrator can assign it to a human OCC Principal in one Namespace. That person can create and manage Agents through the existing OCC Console without Installation administration. No user receives the Role by default. This proposal extends the IAM Driver contract for human identity lookup and managed Namespace-scoped bindings.

## Problem

OCC authorizes each request by action, resource kind, and scope. Current Namespace policy cannot grant `agent:create`, so an administrator must create each Agent and prepare its supporting resources before a user can manage it. The existing Console already supports Agent creation and management, but regular users cannot receive the required collection-level authority.

Kubernetes RoleBindings do not authorize OCC API requests. OCE Agents are not Kubernetes custom resources. This feature therefore grants OCE permissions through OCC IAM and does not grant Kubernetes API access.

## Benefits

- Let an administrator delegate Agent creation and day-to-day management without granting Installation administration.
- Let assigned users use the existing Console and Agent workflow, with no separate onboarding application.
- Keep the feature opt-in and Namespace-scoped so unassigned users retain current access.
- Keep identity, resource permissions, and audit records under the existing OCC authorization model.

## Requirements

- An Installation administrator can assign one managed Agent Author Role to a human OCC Principal in one Namespace. The assignment is optional and has no default.
- Extend the IAM Driver contract to resolve a provisioned human by immutable `principalId` and persist a managed Namespace-scoped AccessBinding in the same platform transaction as its audit record. OCC uses that scope only for the fixed Agent Author Role; arbitrary Namespace-wide create Roles remain rejected. The selected Driver must support the operation or fail closed; OCC does not fall back to another Driver.
- Only the managed Role can grant Namespace-wide `create` permissions. Existing custom Namespace Roles and exact-resource bindings retain their current limits.
- The assigned person can create, read, update, delete, deploy, operate, and read logs for Agents in that Namespace; read Agent revisions; and create, read, update, and delete Configurations.
- The assigned person can create, read, update, delete, and attach Secrets and credential sources through the existing Agent credential and Configuration fields. API and Console responses, audit records, errors, and access summaries must not return stored Secret values. Existing Restrictions continue to override the Role.
- The assigned person can read Namespace ServiceAccounts, Presets, and Sandbox Policies. The Role does not permit ServiceAccount creation, credential issuance, Installation administration, Namespace creation, IAM policy administration, or Sandbox Policy edits.
- When an Agent uses a Secret or credential source, its ServicePrincipal receives `operate` only for the exact resources bound to that Agent. The author cannot grant that Agent access to other resources.
- Give each generated credential binding a stable Agent-specific identity. Reconcile only bindings the system can attribute to that Agent, and preserve equivalent administrator-created or independently managed bindings. Retain grants required by the draft, active revision, or revisions with queued or claimed deployment work. After work becomes terminal, subsequent mutation or activation reconciliation removes unused generated grants. Reconciliation must be idempotent across retries. A fresh Agent Author decision is required to create grants; an otherwise authorized update can still remove obsolete generated grants after the Role is revoked.
- Existing Restrictions continue to override grants. Agent and Configuration mutations, generated credential grants, assigning-session validity, and audit records must commit together or leave no partial authorization change. Agent create, Agent update, and Configuration update must reauthorize after acquiring the Namespace lock shared by policy writes. A mutation waiting behind removal of its Agent Author binding cannot rely on that removed binding: it fails if no other grant allows the resource operation and cannot use the removed role to create automatic credential grants. Session-authenticated mutations must hold and revalidate the assigning session through the resource write, generated credential grants, and audit commit; a revoked or expired session cannot commit those effects.
- Revoking the human's Role denies later requests. It does not stop an Agent already running or retract credentials already delivered to it.

The Role applies to all matching existing and future resources in the Namespace, including Agents and any Secret. It does not distinguish resources by creator. Operators must assign it only where this shared authority is intended. Removing the human binding denies later mutations but does not remove exact credential bindings needed by existing Agents or stop them; their runtime credentials remain available until their Agent configuration or grants change. The existing editable Configuration workflow remains available; a preset-only restriction would require a separate server-enforced capability.

## Non-goals

- General fixed-role catalogs, Groups, arbitrary Namespace-wide custom Roles, or user-managed IAM policy.
- A separate onboarding application, template-only creation, or YAML and GitOps workflows.
- Native Kubernetes User or ServiceAccount access, Kubernetes RoleBindings, or Agent custom resources.
- AWS-specific product behavior.

## Rationale and alternatives

Keeping current behavior preserves existing permissions but requires an administrator to create every Agent for a user. Allowing arbitrary Namespace-wide Roles would let callers define broad collection permissions and expand policy delegation beyond this use case. One fixed, administrator-assigned Role supports self-service while keeping the authority explicit.

The Role is Namespace-wide rather than limited to resources created by its assignee. A creator-only model requires a separate ownership contract. A Preset-only workflow also needs server-side enforcement; hiding Configuration controls in the Console would not restrict API clients.

## Decision requested

Approve an optional, human-only Agent Author Role in the existing OCC Console and the required IAM Driver contract extension. The decision must confirm that an assigned user may manage every matching existing and future resource in one Namespace, including every Secret there. The recommended scope is to accept this shared authority only for Namespaces where operators intend to delegate it.

## Verification requirements

Qualification must show that no access is granted by default; assignment is limited to a human in one Namespace; and a selected Driver without the required lookup or transactional policy support fails without creating a binding or falling back. The regular Kubernetes Agent workflow must show an assigned human succeeding while unassigned, cross-Namespace, restricted, and revoked callers are rejected before unauthorized grants or credential reads. It must cover credential replacement, successful activation of the replacement, removal of obsolete grants, and generated-grant cleanup on Agent deletion.

An assigned human must perform Stop and Delete; both operations must be rejected after revocation. Explicit reassignment must restore the documented authority. Draft edits must preserve grants required by queued and claimed deployments; after that work ends, subsequent reconciliation must remove unused generated grants while preserving independently managed bindings. Evidence must establish that a Restriction applies when its denial is measured and that removing it restores the allowed operation. Agent ServicePrincipals receive only exact credential grants. Provide before-and-after Console screenshots and a short Pages / Create Agent / Agent Author credential-access walkthrough. A development host is a validation environment only and must not require AWS-specific product behavior.

## References

- [Namespace IAM policy flow](../../docs/flows/namespace-iam-policy.md)
- [Agent provisioning flow](../../docs/flows/agent-provisioning.md)
- [Account provisioning](../../docs/reference/authentication.md#account-provisioning)
- [Kubernetes testing](../../docs/testing/kubernetes.md)
