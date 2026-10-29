---
status: Proposed
implementation_status: Not implemented
author: cooktheryan
---

# Proposal: Optional Namespace Agent author role

- **ID:** RFC-0025
- **Created:** 2026-10-29
- **Last updated:** 2026-10-29
- **RFC PR:** [#4045](https://github.com/openclaw/openclaw-enterprise/pull/4045)
- **Implementation plan:** [RFC-0025 implementation plan](../plans/0025-agent-author-role.md)
- **Related:** [Authorization](../../docs/reference/authorization.md), [RFC-0006](0006-basic-rbac/index.md)

## Summary

Add one server-managed **Agent Author** Role that an Installation administrator can assign to a human Principal in one Namespace. The user signs in to the existing OCC Console and creates and manages Agents there. The Role permits the Agent lifecycle and supporting Configuration, Secret, and credential-source work in that Namespace. No user receives it by default. Existing custom Namespace Roles remain exact-resource grants and cannot gain `create` permissions.

## Motivation

OCC checks every operation against the caller's exact action, resource kind, and scope. The bootstrap administrator can create Agents, but a regular user cannot receive `agent:create` through current Namespace policy APIs: those APIs reject `create` Permissions because they only create exact-resource bindings. Agent creation also needs Configuration read access and, depending on the selected resources, Secret, credential-source, and ServiceAccount permissions. The current contract is documented in [Authorization](../../docs/reference/authorization.md#manage-namespace-policy) and the [permissions cheat sheet](../../docs/reference/cheatsheets/permissions.md).

An administrator currently has to create and prepare an Agent for a user, then grant exact-resource access for later management. A Namespace administrator should be able to delegate this work without granting Installation administration or changing existing users' access.

## Goals

- Let an Installation administrator explicitly grant one human user Agent-author permissions in one Namespace.
- Let an assigned user create and manage Agents in the existing OCC Console without Installation administration.
- Support creating and managing Agents and the Namespace resources needed to configure and deploy them.
- Keep unassigned users at their current permissions and preserve Restrictions, audit evidence, and Namespace isolation.
- Grant each Agent's ServicePrincipal `operate` only on the credential resources explicitly bound to that Agent.

## Non-goals

- A general fixed-role catalogue, Groups, arbitrary Namespace-wide custom Roles, or user-managed IAM policy.
- ServiceAccount creation, credential issuance, Installation administration, Namespace creation, Native admin access, or SandboxPolicy editing.
- Console-based IAM administration; current policy management uses the API and CLI.
- Kubernetes RoleBindings for end users or Agent CRDs. OCC Agents are managed through OCC APIs; Kubernetes workload RBAC does not grant OCC permissions.
- AWS-specific behavior. AWS is a validation environment only.

## Proposal

The selected IAM Driver continues to own identity resolution and authorization decisions. Its identity lookup contract must resolve a Principal by its immutable ID so OCC can verify a Namespace-binding subject as a human before writing the grant. A driver that cannot make this check must reject preset assignment; OCC must not infer identity type from an ID prefix or fall back to another Driver.

`POST /namespaces/:namespaceId/iam/roles` accepts the preset body `{ "preset": "agent-author" }` and returns the immutable canonical Role with ID `role_<namespaceId>_agent_author`. It does not accept caller-supplied permissions or a name for this preset. Repeating the request returns the same Role if its stored permissions match; a conflicting Role at that ID fails with `409`.

`POST /namespaces/:namespaceId/iam/access-bindings` accepts `{ "subjectKind": "identity", "subjectId": "<human-principal-id>", "roleId": "<agent-author-role-id>", "scope": "namespace" }`. The IAM Driver must support an untargeted Namespace AccessBinding in its transactional write contract. This is the only Namespace-scoped binding variant: it rejects Groups, ServicePrincipals, arbitrary Roles, and any other Namespace-wide binding. Existing exact-resource binding requests keep their current shape. Creating or assigning the preset still requires the current Installation `administer` and Namespace `read` checks. A missing assignment grants nothing.

An assigned user uses the existing OCC Console. The current Agent creation page can start from a Preset and also permits custom Configuration values. This proposal supports that existing build-your-own workflow within the assigned Namespace. A Preset-only workflow needs a server-enforced contract; hiding Configuration controls in the Console would not restrict API clients.

The Role grants these permissions throughout the assigned Namespace:

| Resource kind       | Permissions                                                            |
| ------------------- | ---------------------------------------------------------------------- |
| `namespace`         | `read`                                                                 |
| `agent`             | `create`, `read`, `update`, `delete`, `deploy`, `operate`, `read_logs` |
| `agent_revision`    | `read`                                                                 |
| `configuration`     | `create`, `read`, `update`, `delete`                                   |
| `secret`            | `create`, `read`, `update`, `delete`, `operate`                        |
| `credential_source` | `create`, `read`, `update`, `delete`, `operate`                        |
| `service_account`   | `read`                                                                 |
| `preset`            | `read`                                                                 |
| `sandbox_policy`    | `read`                                                                 |

This scope lets the assigned user manage existing and future resources of those kinds in that Namespace, not only resources the user created. `secret:operate` permits using a Secret but never returns its value; it therefore lets the user bind any Secret in the Namespace to an Agent. The user may use an existing ServiceAccount but cannot create one or issue its credentials. `read_logs` is included for runtime troubleshooting. The Role does not grant Agent `administer` or `manage_policy`, Secret or credential-source permissions in other Namespaces, or any Installation permission.

The Role preset is the only path that can create a Namespace-scoped binding with `create` Permissions. The general Role API continues to reject custom Roles with `create`; the general AccessBinding API continues to reject Namespace-scoped bindings for other Roles. The preset cannot be updated; it can be deleted only when unbound and recreated through the preset request. Existing exact-resource bindings keep their current request shape and behavior.

When an author creates or updates an Agent with bound Secrets or credential sources, OCC verifies the author's `operate` permission and transactionally grants the Agent ServicePrincipal `operate` on those exact references. This lets the existing Console complete credential setup without asking the user to administer IAM policy. OCC removes only bindings created by this mechanism when an Agent no longer uses a reference; it preserves administrator-created bindings. Agent deletion removes bindings for its deleted ServicePrincipal through the existing cleanup path. Audit records include the exact grants and removals. A selected IAM Driver that cannot join the State transaction fails the operation before partial policy or Agent changes commit. Restrictions still override the author's permissions.

Namespace Role and AccessBinding writes remain under the existing IAM policy transaction and audit path. Revoking the user's binding denies later requests but does not stop a running Agent or revoke credentials already delivered to it.

## Rationale and alternatives

Keeping current behavior would preserve least privilege but would continue to require an administrator for every new Agent and its dependencies. Allowing arbitrary Namespace-scoped Roles and `create` Permissions would make the feature flexible, but would reopen broad policy delegation that [RFC-0006](0006-basic-rbac/index.md) defers. One fixed, administrator-assigned preset supports the requested workflow while keeping the new authority explicit and reviewable.

The chosen Role is intentionally Namespace-wide. A creator-only model would require a separate ownership and automatic-grant contract. The broader choice means any assigned user can use or delete matching resources already in the Namespace; operators must assign it only where that authority is acceptable. This MVP uses the existing editable Agent Configuration workflow. If the product needs template-only creation, that requires an API restriction and a separate decision.

## Delivery and verification

Submit this RFC before implementation and keep its implementation status separate from delivery progress. The linked plan covers the API/CLI contract, transactional exact grants, current references and flow documentation, and integration proof. Verify denied access without a binding, granted Agent create/update/deploy/stop/log/delete through the regular workflow, cross-Namespace denial, credential binding boundaries, and revocation. Run the same workflow on the configured disposable AWS development host after local integration proof; add no AWS-specific product behavior.

## References

- [Namespace IAM policy flow](../../docs/flows/namespace-iam-policy.md)
- [Agent provisioning flow](../../docs/flows/agent-provisioning.md)
- [Account provisioning](../../docs/reference/authentication.md#account-provisioning)
- [Kubernetes testing](../../docs/testing/kubernetes.md)
