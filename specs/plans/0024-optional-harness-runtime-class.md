---
rfc: ../rfcs/0024-optional-harness-runtime-class.md
---

# Implement optional dedicated Harness RuntimeClass

- **ID:** RFC-0024
- **Delivery status:** In progress
- **Authority:** [Optional Harness RuntimeClass proposal](../rfcs/0024-optional-harness-runtime-class.md)
- **Source baseline:** `222d2266842db457415e146b70a30abf430480aa`

## Outcome and scope

An operator can opt Compute-owned dedicated Harnesses into a named RuntimeClass without changing an unset Installation. [RFC-0024](../rfcs/0024-optional-harness-runtime-class.md) owns the decision. Gateway, embedded, and Sandbox-owned Pods retain their current runtime and mounts.

## Contract and source touchpoints

The [Kubernetes Compute Driver](../../apps/controller/src/drivers/compute/kubernetes/index.ts) owns configuration validation, Deployment rendering, and readiness. Its [repository material helper](../../apps/controller/src/drivers/compute/kubernetes/repository-material.ts) and [private-file reader](../../apps/controller/src/drivers/repo/github/credentials/client/private-files.ts) own the opt-in whole-volume custody path. No platform-core branch or RuntimeClass management permission is added.

## Implementation

1. Validate the optional class name. Treat empty and whitespace-only values as unset. Keep the default template byte-for-byte equivalent for existing Installations.
2. For selected Compute-owned Harnesses, mount the existing claim and Pod-local volumes without `subPath`. Prepare private children and links before workspace setup. Preserve the existing Gateway template and Secret projection.
3. Require the class on the Deployment template and observed ready Pod. Record the selected path in the Kubernetes reference, operator guide, and Harness execution flow.
4. Qualify Kata on a disposable KVM-capable host. Keep the handler, RuntimeClass scheduling, overhead, and node setup under operator control.

## Verification

| Outcome                                                                                  | Check                                                                                  | Current result                                                          |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Unset and blank configuration retains current behavior                                   | Existing and selected Kubernetes Driver conformance cases                              | Focused cases, typecheck, lint, and workspace boundary pass locally.    |
| Selected Harness retains class and has no `subPath` mount                                | Existing real Agent API and worker workflow in k3d, with `OCC_TEST_KATA_RUNTIME_CLASS` | Test path wired; KVM run pending.                                       |
| Model/tool turn, workspace replacement, Secrets, repository material, and network policy | Existing real Agent workflow with Kata on KVM                                          | Pending; the Kata smoke Pod does not exercise the Agent workflow.       |
| Missing class or suitable node leaves Agent unready                                      | Real k3d Agent deployment                                                              | Pending.                                                                |
| Guest VM, QEMU, and Codex localhost seccomp profile                                      | Kata guest and host observations                                                       | Guest VM and RuntimeDefault seccomp passed; Codex profile pending.       |

The disposable `oce-demo` M7i host exposed `/dev/kvm` and `vmx` after nested virtualization was enabled. Kata 4.3.1's pinned QEMU `runtime-rs` shim booted a smoke Pod in k3d: the host kernel was `7.2.11-200.fc44.x86_64`, the guest kernel was `6.18.56`, and a QEMU process existed in the k3d node. The smoke Pod reached Ready in 5 seconds. A second guest Pod resolved the Kubernetes Service name and reported `Seccomp: 2` with one filter after the trial changed `disable_guest_seccomp` to `false`; this value is `true` in the shipped configuration. Its QEMU process had about 274 MiB resident memory while configured with 2 GiB guest memory. These observations do not establish a Codex model turn or its localhost seccomp profile.

The disposable Fedora host required permissive SELinux for `virtiofsd` to write under `/run/kata`. An enforcing policy remains an operator qualification requirement. The k3d node needed host `/dev/shm` mounted to boot the 2 GiB guest; its default 64 MiB shared memory mount caused VM startup failure. No CI runner is currently documented as KVM-capable, so the Kata variant is not registered as a passing CI lane.

## Delivery record

The proposal was submitted in [PR #3893](https://github.com/openclaw/openclaw-enterprise/pull/3893). The implementation is on its draft branch. Do not mark this plan complete until the real runtime checks pass and current documentation describes the shipped behavior.

## Manual Notes

## Changelog

- 2026-10-27 15:25: Started the opt-in implementation plan from the submitted RFC (`3ece0cfe`; authoring-run/f826be86-eb99-46ad-b2e4-ecdf6b3a0bd8).
