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

Add an optional, fixed **Agent Author** Role. An Installation administrator can assign it to a human OCC Principal in one Namespace. That person can create and manage Agents through the existing OCC Console without Installation administration. No user receives the Role by default.

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
- Only the managed Role can grant Namespace-wide `create` permissions. Existing custom Namespace Roles and exact-resource bindings retain their current limits.
- The assigned person can create, read, update, delete, deploy, operate, and read logs for Agents in that Namespace; read Agent revisions; and create, read, update, and delete Configurations.
- The assigned person can create, read, update, delete, and use Secrets and credential sources in that Namespace. Secret values remain undisclosed by permission checks and Console access summaries.
- The assigned person can read Namespace ServiceAccounts, Presets, and Sandbox Policies. The Role does not permit ServiceAccount creation, credential issuance, Installation administration, Namespace creation, IAM policy administration, or Sandbox Policy edits.
- When an Agent uses a Secret or credential source, its ServicePrincipal receives `operate` only for the exact resources bound to that Agent. The author cannot grant that Agent access to other resources.
- Existing Restrictions continue to override grants. Policy changes and Agent credential changes must preserve audit evidence and must not leave partial authorization changes if an operation fails. Session-authenticated Agent create, Agent update, and Configuration update must hold and revalidate the assigning session through the resource write, generated credential grants, and audit commit; a revoked or expired session cannot commit those effects.
- Revoking the human's Role denies later requests. It does not stop an Agent already running or retract credentials already delivered to it.

The Role applies to all matching existing and future resources in the Namespace, including Agents and any Secret. It does not distinguish resources by creator. Operators must assign it only where this shared authority is intended. The existing editable Configuration workflow remains available; a preset-only restriction would require a separate server-enforced capability.

## Non-goals

- General fixed-role catalogs, Groups, arbitrary Namespace-wide custom Roles, or user-managed IAM policy.
- A separate onboarding application, template-only creation, or YAML and GitOps workflows.
- Native Kubernetes User or ServiceAccount access, Kubernetes RoleBindings, or Agent custom resources.
- AWS-specific product behavior.

## Rationale and alternatives

Keeping current behavior preserves existing permissions but requires an administrator to create every Agent for a user. Allowing arbitrary Namespace-wide Roles would let callers define broad collection permissions and expand policy delegation beyond this use case. One fixed, administrator-assigned Role supports self-service while keeping the authority explicit.

The Role is Namespace-wide rather than limited to resources created by its assignee. A creator-only model requires a separate ownership contract. A Preset-only workflow also needs server-side enforcement; hiding Configuration controls in the Console would not restrict API clients.

## Decision requested

Approve an optional, human-only Agent Author Role in the existing OCC Console. The decision must confirm that an assigned user may manage every matching existing and future resource in one Namespace, including every Secret there. The recommended scope is to accept this shared authority only for Namespaces where operators intend to delegate it.

## Verification requirements

Qualification must show that no access is granted by default; assignment is limited to a human in one Namespace; cross-Namespace and restricted requests remain denied; the assigned person can complete the regular Agent lifecycle; Agent ServicePrincipals receive only exact credential grants; and revocation prevents later requests. Runtime qualification must use the supported Kubernetes Agent workflow. A development host is a validation environment only and must not require AWS-specific product behavior.

## References

- [Namespace IAM policy flow](../../docs/flows/namespace-iam-policy.md)
- [Agent provisioning flow](../../docs/flows/agent-provisioning.md)
- [Account provisioning](../../docs/reference/authentication.md#account-provisioning)
- [Kubernetes testing](../../docs/testing/kubernetes.md)
