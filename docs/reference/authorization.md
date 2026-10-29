# Authorization

Identity and access management (IAM) determines who can read, create, change,
or operate OpenClaw Enterprise resources. Every operation is checked against
its exact action, resource, and [Namespace](namespaces.md). Requests without an
explicit matching grant are denied. This page defines the current authorization
contract; [authentication](authentication.md) defines how API clients establish
a session or verify a service key.

```text
Principal, ServicePrincipal, or Group
        │
        ▼
AccessBinding ──► Role ──► Permission
        │                     │
        └── exact scope ──────┘
                 │
                 ▼
       Matching Restriction?
           yes ──► deny
            no ──► allow
```

## Supported policy surface

Fresh native-IAM bootstrap provisions a human administrator and an
Installation-scoped, non-Agent ServicePrincipal. Each receives a binding to
the same administrator Role, without a Namespace or resource filter:

| Resource kind                                | Actions                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `installation`                               | `administer`, `read`                                                    |
| `namespace`                                  | `create`, `read`, `delete`                                              |
| `configuration`, `preset`, `service_account` | `create`, `read`, `update`, `delete`                                    |
| `secret`                                     | `create`, `read`, `update`, `delete`, `operate`                         |
| `credential_source`                          | `create`, `read`, `update`, `delete`, `operate`                         |
| `agent`                                      | `create`, `read`, `update`, `delete`, `deploy`, `operate`, `administer` |
| `agent_revision`                             | `read`                                                                  |

These grants cover current and future Namespaces, subject to authorization and
Restrictions. They grant no Kubernetes or provider authority. Bootstrap does
not rewrite stored grants; an older Installation may lack actions added later,
such as `credential_source:update`, until an administrator grants them. Custom
Roles do not gain permissions automatically. Preset upgrades extend only the
built-in administrator Role; see [Preset upgrade eligibility](presets.md#crud-and-permissions).
Removing the human account does not remove the service identity. See
[bootstrap authentication](authentication.md#installation-and-account-ownership)
for credential delivery and lifecycle.

Administrators can provision additional local authentication accounts with a
binding to an existing Role, as defined in
[account provisioning](authentication.md#account-provisioning). Public signup
is disabled. Creating an account does not create a Role or implicitly grant
administrator rights.

Administrators manage immutable Namespace Roles and exact-resource identity
AccessBindings through the [Namespace policy APIs](#manage-namespace-policy).
Group, membership, and Restriction management remain unavailable through the
Namespace policy API. Namespace-wide grants are limited to the managed Agent
Author preset; other creation requests remain narrower than the internal policy
models below.

## Principals

A Principal is a provisioned human caller identified by its trusted issuer and
immutable subject. A ServicePrincipal is an automation identity scoped to the
Installation or one Namespace. Each [Agent](agents.md) owns one immutable,
Namespace-scoped ServicePrincipal; other ServicePrincipals represent automation.

The controller authenticates people from sessions and non-Agent
ServicePrincipals from [service API keys](authentication/service-api-keys.md).
The IAM Driver receives the verified `servicePrincipalId` and its stored
Namespace. Agent-owned principals cannot use ordinary service keys. The
[Kubernetes Compute Driver](drivers/kubernetes-compute.md) can project a
short-lived, audience-scoped Kubernetes ServiceAccount token into an Agent's
Pods. The token is local runtime evidence; it is not an OCC identity or a
credential for another cluster. OCC token verification, identity exchange, and
workload authentication through the controller API remain deferred.

An unknown identity is denied. Email addresses, display names, caller-supplied
identity headers, or membership in another Namespace do not grant access.

## Permissions and Roles

A Permission pairs an `action` with a `resourceKind`; a Role groups these
Permissions. The kind selects a category such as `agent`, not an individual
Agent ID. The [permissions cheat sheet](cheatsheets/permissions.md) lists the
supported action/kind pairs and operations requiring additional grants.
`read_logs` delegates Agent log access without `administer` and is not granted
by fresh bootstrap.

An OCC-owned [service account](service-accounts.md) is not an IAM principal,
and IAM never accesses its credentials. Creation requires `create` in its exact
Namespace and other operations their exact-account permission; its reference
defines the account `read` that associated Agent operations need.

The [generated API reference](api.md) lists each operation's permissions from
the `x-openclaw-permissions` array in the
[OpenAPI contract](../../packages/contracts/openapi/occ-api.openapi.json).
Collection scopes distinguish the parent check from checks on returned items.

The following TypeScript interfaces summarize the
[internal models](../../packages/contracts/src/index.ts). Fields without `?`
are required; `?` marks optional model fields, not permission to omit them from
creation requests.

```ts
import type { PermissionAction, ResourceKind } from "@openclaw-enterprise/contracts";

interface Permission {
  action: PermissionAction;
  resourceKind: ResourceKind;
}

interface Role {
  id: string;
  namespaceId?: string;
  name?: string;
  permissions: readonly Permission[];
}
```

`id` identifies the stored Role; `name` is an optional display label, not an
authority. `namespaceId` limits its Permissions to one Namespace; omission means
Installation scope. The Role grants nothing until an AccessBinding assigns it.

## Access bindings and Groups

An AccessBinding attaches a Role to one identity or Group:

```ts
interface AccessBinding {
  id: string;
  namespaceId?: string;
  subjectKind: "identity" | "group";
  subjectId: string;
  roleId: string;
  resourceKind?: ResourceKind;
  resourceId?: string;
}
```

`id` identifies the binding. `subjectKind` selects whether `subjectId` names an
identity or Group; `roleId` selects the Role. `namespaceId` bounds the grant.
`resourceKind` and `resourceId` select an exact target and must appear together
or both be absent. Only matching Role Permissions apply. With neither target
field, a Namespace-scoped binding grants matching actions across that Namespace,
including future resources. Omitting both Namespace and target filters permits
Installation-wide grants. An exact `namespace` target grants Namespace actions
only; Namespace `read` does not grant child access or permission to create them.

The [Namespace read schemas](../../packages/contracts/src/api/resources.ts)
require `id` and `namespaceId`, retain optional Role `name`, and can return Group
or untargeted bindings. Their broader shapes do not expand creation support.

Groups collect human Principals for shared Role grants. ServicePrincipals receive
direct AccessBindings. Membership is direct and must remain inside the Group's
scope.

## Manage Namespace policy

Namespace policy writes require an IAM Driver that declares
`namespacePolicyTransaction: "platform-unit-of-work"`. Otherwise OCC rejects the
write before calling the Driver, so a later denial cannot leave an external grant.

Human-session policy mutations retain the assigning session through the transaction.
Completed revocation prevents a pending write. PostgreSQL validates session expiry
during COMMIT and rolls back policy and its success audit if the session expired.
A protected write may finish before logout completes.
See the [Namespace IAM flow](../flows/namespace-iam-policy.md) for the implementation.

Use `/namespaces/:namespaceId/iam/roles`,
`/namespaces/:namespaceId/iam/access-bindings`, and
`/namespaces/:namespaceId/iam/service-principals` to list, create, inspect, and
delete Namespace policy. OCC generates resource IDs. A ServicePrincipal
created here is a Namespace-scoped non-Agent identity with no grant; bind it
and issue its [service key](authentication/service-api-keys.md). The API cannot
delete it, and Namespace deletion does not revoke its keys. Lists omit
Installation bootstrap policy and include broad and Group bindings. See the
creation rules below for allowed subjects and targets.

Every operation requires Installation `administer` and exact Namespace `read`,
evaluated by the selected IAM Driver and applicable Restrictions. An
exact-resource binding also requires `read` on its target. The managed
Agent Author assignment uses a Namespace scope and has no resource target.

`create` is checked against the Namespace rather than an existing resource, so
custom Roles cannot grant it. Binding creation returns `400 INVALID_REQUEST`
at `/roleId` when a Role has no Permission for the exact target kind. The
managed Agent Author preset is the only exception: its fixed Permissions are
bound at Namespace scope. Ordinary resource access does not authorize
delegation. Drivers without policy management return `503 DEPENDENCY_UNAVAILABLE`;
OCC never substitutes native IAM.

These interfaces summarize the [HTTP creation bodies](../../packages/contracts/src/api/common.ts).
OCC generates `id` and takes `namespaceId` from the URL; extra fields are rejected.

```ts
import type { ManagedIAMResourceKind, PermissionAction } from "@openclaw-enterprise/contracts";

type CreateRoleRequest =
  | { preset: "agent-author" }
  | {
      name?: string;
      permissions: {
        action: PermissionAction;
        resourceKind: ManagedIAMResourceKind;
      }[];
    };

type CreateAccessBindingRequest = {
  subjectKind: "identity";
  subjectId: string;
  roleId: string;
} & ({ resourceKind: ManagedIAMResourceKind; resourceId: string } | { scope: "namespace" });
```

Role creation requires 1–64 duplicate-free Permissions with supported action/kind
pairs. Unsupported pairs such as `secret:read_logs` return `400 INVALID_REQUEST`
at `/permissions`. Only the managed Agent Author preset can use a Namespace-wide
binding; Group bindings remain outside the creation API.

For an exact Secret grant to an Agent, create a Role with `secret:operate`, then
bind it to the Agent's ServicePrincipal and that Secret ID. The binding limits
the Role permission to one Secret. Policy objects do not contain Secret values.
See [Let an Agent use a Secret](../guides/topics/iam.md#let-an-agent-use-a-secret)
for the CLI procedure.

An exact-resource binding subject must be an existing human Principal or
ServicePrincipal in the path Namespace, identified by ID. Email addresses are
rejected; a human does not need a separate Namespace ServicePrincipal. The Role
and exact target must exist in that Namespace. Namespace Permissions support
only `read`, and an exact Namespace target must match the path ID. Agent
revision `read` requires an `agent_revision` target. An OCC ServiceAccount is
not an IAM identity. Caller-supplied IDs, wildcard targets, Groups, and unknown
permissions are rejected. Only the Agent Author preset accepts
`scope: "namespace"`, and only for a human Principal. Invalid Permissions or
subjects, Roles, targets, or Agents being deleted return `400 INVALID_REQUEST`
with the offending field as the detail path. Native IAM commits the validated
policy and its audit event together; other replicas see it without a restart.

## Agent Author role

An Installation administrator can create the fixed Agent Author Role and assign
it to a human Principal in one Namespace. The assigned person uses the existing
OCC Console and API to create and manage Agents there without Installation
administration. The Role has no default assignment and cannot be edited. Delete
it only after all its AccessBindings are removed.

| Resource kind                                 | Permissions                                                            |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `namespace`                                   | `read`                                                                 |
| `agent`                                       | `create`, `read`, `update`, `delete`, `deploy`, `operate`, `read_logs` |
| `agent_revision`                              | `read`                                                                 |
| `configuration`                               | `create`, `read`, `update`, `delete`                                   |
| `secret`                                      | `create`, `read`, `update`, `delete`, `operate`                        |
| `credential_source`                           | `create`, `read`, `update`, `delete`, `operate`                        |
| `service_account`, `preset`, `sandbox_policy` | `read`                                                                 |

The grant covers matching resources already in the Namespace and resources
created later. It can manage another person's Agents and use every Secret in
that Namespace. Assign it only where users may share that authority. It grants
no Installation administration, IAM policy management, or ServiceAccount
creation. A Restriction can still deny an operation.

When an Agent Author creates or updates an Agent with credential references,
OCC grants that Agent's ServicePrincipal `operate` only on those Secrets and
credential sources in the same transaction. OCC removes generated grants that
become unused after a replacement revision starts. Revoking the human binding
denies later OCC requests but does not stop running Agents or revoke credentials
already delivered to them. This does not grant Kubernetes API access or create
a Kubernetes RoleBinding.

For exact-resource human grants, assign Namespace `read` and separately grant
the required actions on each Agent. Human enrollment and grants are separate.

Roles and bindings cannot be updated. Replace them by creating new policy and
removing old bindings. A referenced Role cannot be deleted (`409`), and deleting
one binding preserves equivalent and unrelated grants. Deleting a Configuration,
Preset, Secret, credential source, or ServiceAccount removes its exact bindings
in the same transaction and records their IDs in the audit event. Agent deletion
is asynchronous; completion removes bindings for the Agent, its revisions, and
its ServicePrincipal, plus deny Restrictions on the Agent or revisions. The
audit event lists removed bindings and Restrictions when present. Namespace
teardown removes its Roles and bindings with the tombstone. After an unknown
creation outcome, inspect policy before retrying; equivalent bindings can
coexist. Role names are labels, so inspect permissions before reusing a Role.

Deleting a binding does not establish effective denial: other bindings and
Restrictions still apply. Revocation blocks later admission but cannot retract
already delivered bytes. Stop the Agent and revoke upstream credentials when
immediate containment is necessary; IAM changes do neither automatically.

## Restrictions

A Restriction narrows permissions that would otherwise be granted. It can deny
an exact action for a resource kind, a Namespace, or an exact resource:

```json
{
  "id": "restriction-support-deploy",
  "namespaceId": "ns_45b6dbdb-2fc2-4c2c-9cc4-a94cf26cc6c2",
  "action": "deploy",
  "resourceKind": "agent",
  "effect": "deny"
}
```

A matching Restriction overrides direct identity grants and Group grants. A
Restriction never grants access, expands scope, or selects a different
authorization provider.

## Authorization decisions

For each protected operation, the controller:

1. Verifies the user session or service key and resolves its provisioned
   Principal or ServicePrincipal through the selected IAM Driver.
2. Uses the server-configured IAM Driver for the requested resource.
3. Loads current policy, including principal bindings and direct Group memberships.
4. Requires a Role Permission matching the exact action and resource kind.
5. Verifies the exact Installation, Namespace, or resource scope.
6. Rejects matching Restrictions equally for human and service identities.
7. Records attributable authorization evidence without exposing credentials.

Lists are authorized per resource. Permission to deploy an Agent does not grant
permission to read it, and reading one Agent does not expose every Agent in the
Namespace. First deployment may also need Agent `read` and `operate` when
Compute must generate transport credentials.

[Agent runtime reads](../guides/topics/agent-logs.md#who-can-see-what) use two
tiers on the exact Agent and version: Pod status and Events need Agent
`operate` and `read` plus Agent revision `read`; container log text needs Agent
`read_logs` or `administer` and Agent `read`, which cover every version of that
Agent, including later deployments. A matching `read_logs` Restriction denies
log text even to a holder of `administer`. Each follow poll is authorized again,
so revoking a grant stops the next poll.

The selected IAM Driver loads current authoritative policy for each identity
lookup and decision, so account and permission changes reach every controller
instance without restarting or replacing the Driver.

An unavailable Driver, invalid policy, missing grant, mismatched scope, or
ambiguous identity fails closed.

## Denials and failures

- `401`: The session cookie or service key is missing, invalid, expired, or revoked.
- `403`: The principal lacks an exact grant, belongs to another Namespace, or
  matches a deny Restriction. The message names the grant; see
  [denial messages](cheatsheets/permissions.md#denial-messages).
- `404`: The resource does not exist under its exact parent, and your grants
  cover its ID. Others get the same `403` as for a resource they cannot read.
- `503 DEPENDENCY_UNAVAILABLE`: The selected IAM or audit dependency is
  unavailable; no fallback authorization provider is used.
- A resource is absent from a list: your identity may lack `read` on that
  specific resource.
- `400` creating a Role or binding: the detail path names the invalid field.
- `409` deleting a Role: the Role is referenced by AccessBindings; remove them
  explicitly first.

## Evidence and related references

The current policy implementation is
[the IAM package](../../packages/iam/src/index.ts).

For a working authenticated request, see the
[quickstart](../guides/quickstart.md#read-the-installation-with-the-bootstrap-service-key).

- [IAM overview](../guides/topics/iam.md)
- [Authorization tests](../testing/local.md#authentication-and-authorization-coverage)
- [Controller configuration](settings.md)
- [Platform architecture](../design.md)

## Manual Notes

[keep this for the user to add notes. do not change between edits]

## Changelog

- 2026-10-29: Document the managed Agent Author Role and Namespace binding contract.
- 2026-10-06 15:40: Agent-targeting bindings are removed on deletion completion; the audit lists appear only when nonempty. (dogfood-r37)

- 2026-10-03 16:45: The Agent delete event lists the Restrictions its completion removes. (deletion-audit-restrictions)

- 2026-09-19 20:53: Document Namespace Role and exact identity AccessBinding management. (codex/01a0bce5-9f29-7110-85fd-6b140674d362 - 06c23b9cf60915ba58baa38b23cf304562e674a1)

- 2026-08-31 17:43: Document fresh human/service administrator bootstrap, private key delivery, and operator recovery. (codex/01a05a69-3fbe-7441-9e6d-20394758cf94 - 0797098646028ac00cb26cd4afcbc9b2cf8bcb24)

- [2026-08-28 17:54]: Reorganize as a current feature reference; move procedural setup to the shared guides. (01a036f4-cf1d-7cc1-bbc1-000879038ac8 - 4270aa29b7015562049f46c6027962fd85b584a9)
