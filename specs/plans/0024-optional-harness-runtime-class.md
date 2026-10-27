---
rfc: ../rfcs/0024-optional-harness-runtime-class.md
---

# Plan optional dedicated Harness RuntimeClass support

- **ID:** RFC-0024
- **Delivery status:** Planned
- **Authority:** [Optional Harness RuntimeClass RFC](../rfcs/0024-optional-harness-runtime-class.md)
- **Source baseline:** `222d2266842db457415e146b70a30abf430480aa`

## Outcome

An operator can select a RuntimeClass for Compute-owned dedicated Harnesses. An absent, empty, or whitespace-only setting preserves the current runtime and Pod layout. Gateways, embedded Agents, and Sandbox-owned Harnesses stay outside this change. A selected class that cannot run leaves the Agent unready and does not fall back to the cluster default.

## Delivery steps

1. Add optional Installation configuration `runtime.harnessRuntimeClassName` to the Kubernetes Compute Driver. Validate a nonblank name as an exact Kubernetes RuntimeClass name. Do not create or manage RuntimeClasses in OCE.
2. Change only the selected dedicated Harness template to mount its existing persistent claim and Pod-local state as whole volumes. Prepare private workspace and state paths before the Harness starts. Preserve persistence, file permissions, Secret projection, repository material, and the Gateway/Harness storage split.
3. Observe the selected class on the Deployment template and ready Harness Pod before reporting readiness. Keep an unavailable class or node as a visible failure.
4. Document operator setup and verification in the Kubernetes reference and guide. Update the source-backed Harness execution flow. The operator owns Kata installation, node placement, RuntimeClass scheduling and overhead, SELinux policy, KVM, and VM attestation.
5. Extend the existing real k3d Agent workflow on a qualified KVM runner. Register a separate Kata CI variant without changing the ordinary lane.

## Required verification

- Compare unset and blank configuration with the current Harness and Gateway manifests. Confirm the selected Harness has the exact class and no `subPath` mount, including optional repository material.
- Prove a real model and tool turn, retained workspace across Harness replacement, Secret delivery, repository material when enabled, and default-deny networking through the regular Agent workflow.
- Remove or make the selected RuntimeClass or its node unavailable and confirm that the Agent remains unready without runtime fallback.
- Compare host and guest kernels, observe the QEMU VM, and verify Codex's localhost seccomp profile inside the guest. Record startup time, memory use, volume behavior, network behavior, and failures.

## Feasibility evidence and limits

A disposable AWS M7i host with nested KVM booted a Kata 4.3.1 QEMU `runtime-rs` smoke Pod in k3d. The guest kernel differed from the host, QEMU ran in the node, cluster DNS resolved, and guest seccomp became active after the trial enabled it. The smoke Pod reached Ready in 5 seconds. The trial needed host `/dev/shm` in the k3d node and a permissive Fedora SELinux mode for `virtiofsd`; an enforcing policy remains unqualified. No OCE model or tool turn ran under Kata. The smoke trial does not satisfy the required Agent workflow checks or establish production support.

## Manual Notes

## Changelog

- 2026-10-27: Proposed this plan with RFC-0024. The feasibility smoke trial does not change its Planned status.
