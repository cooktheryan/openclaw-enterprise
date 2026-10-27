---
status: Proposed
implementation_status: Not implemented
author: cooktheryan
---

# Optional RuntimeClass for Compute-owned dedicated Harnesses

**RFC-0024** · Proposed 2026-10-27 · [Kubernetes Compute Driver](../../docs/reference/drivers/kubernetes-compute.md)

[Implementation plan](../plans/0024-optional-harness-runtime-class.md) · [RFC review](https://github.com/openclaw/openclaw-enterprise/pull/3893)

## Decision

Add `drivers.compute.configuration.runtime.harnessRuntimeClassName` to the bundled Kubernetes Compute Driver. An Installation may set it to the name of an operator-installed Kubernetes RuntimeClass for Compute-owned dedicated Harness Pods. An absent, empty, or whitespace-only value selects the existing Pod template, volume layout, and cluster default runtime. A nonblank value selects the named class and a compatible Harness volume layout. It does not change Gateway Pods, embedded Agents, or Sandbox-owned Harnesses.

This is an optional isolation choice. OCE does not install Kata Containers, configure nodes, create a RuntimeClass, or infer that a named class uses Kata. Operators who want Kata must configure a Kata handler and RuntimeClass, set this field to its name, and verify that a Harness runs in a guest VM.

## Why this is needed

The [Kubernetes Compute Driver](../../apps/controller/src/drivers/compute/kubernetes/index.ts) currently leaves `runtimeClassName` unset and uses `volumeMount.subPath` for private state and persistent Harness workspace paths. [Kata documents `subPath` as unsupported](https://github.com/kata-containers/kata-containers/blob/main/docs/Limitations.md#kubernetes-volumemountssubpaths). Merely naming a RuntimeClass would therefore leave the current dedicated Harness incompatible with Kata. The existing Gateway and embedded Agent behavior must remain the default for every Installation.

## Benefits of the optional setting

- A selected Kata handler runs the dedicated Harness Pod in a VM with its own guest kernel. This adds a hardware virtualization boundary around Codex tools that execute Agent-selected code. The [Kata architecture](https://github.com/kata-containers/kata-containers/blob/main/docs/design/virtualization.md) describes this as a second isolation layer; it does not replace OCE's Secret custody, NetworkPolicies, or tenant permissions.
- The operator can enable this boundary for Compute-owned dedicated Harnesses without moving Gateways or embedded Agents. Existing Installations keep their Pod template, mounts, runtime, and resource use when the field is absent or blank.
- A configured but unavailable class leaves the Agent unready. This makes runtime selection visible to the operator and prevents a silent change to the cluster's default handler. The class name itself is not proof of a VM; the operator must verify the guest and hypervisor.

## Decision requested from Compute owners

Should Kubernetes Compute accept this Installation-level RuntimeClass selector and maintain a second, compatible mount layout for its dedicated Harnesses? The recommendation is to accept this bounded contract. It addresses Kata's documented mount limitation while leaving all unset and blank Installations on the current path. The extra Driver setting and layout carry maintenance cost; support must wait for the real Agent integration and installed-runtime qualification in the [plan](../plans/0024-optional-harness-runtime-class.md). This RFC remains Proposed until a Compute owner records a decision.

## Proposed contract and boundaries

- The setting belongs to the Kubernetes Compute Driver's Installation configuration. It is optional and does not add a platform-core branch or a new Agent setting. Whitespace around a nonblank value is not silently changed; the value must be an exact valid Kubernetes RuntimeClass name. Empty and whitespace-only values mean unset.
- With a nonblank value, Compute renders `spec.template.spec.runtimeClassName` on its dedicated Harness Deployment. It prepares private home and persistent workspace paths through whole-volume mounts, without any `subPath` mount in that Pod's containers or init containers. The volume change applies only to the opt-in template. Persistent workspace state, Pod-local state, ownership, Secret projection, and private permissions retain their current meanings.
- The opt-in Pod mounts its ephemeral home volume at `/home` and creates `/home/node` as an owner-only child. It mounts the existing Harness claim once at `/harness-workspace-state` and links the approved workspace and node-state paths into that claim. It mounts repository material at `/run/oce` and creates an owner-only credential child. The `/run/oce` root is writable to the Pod's `fsGroup`; the credential client accepts that exact Pod-local ancestor only for the opt-in path and still requires owner-only credential directories and files. The regular layout and checks remain unchanged.
- Compute observes the selected RuntimeClass on the Deployment template and the live Harness Pod before reporting the workload ready. A missing class, unsupported handler, or unavailable node leaves the Agent unready; reconciliation must not remove the configured class or retry on the cluster default handler. Removing the setting is an explicit operator change that restores the current default template on subsequent reconciliation.
- The Gateway retains its existing runtime and storage layout. Sandbox-owned Harnesses, including OpenShell, have their own runtime and admission contract and need separate qualification. This field does not claim or override them.
- Operators own the runtime handler, node placement, RuntimeClass scheduling and overhead, KVM access, and guest isolation verification. Kubernetes accepting a RuntimeClass name does not attest its handler. OCE does not gain cluster-wide RuntimeClass management permissions.

## Delivery and evidence

Implement the optional Driver configuration and gated Harness template as one change, with the current default path preserved. Extend the existing real Agent workflow with a KVM-capable Kata lane. Prove a model and tool turn, persistent workspace across Harness replacement, Secret and optional repository material delivery, network isolation, and an unready Agent when the class or suitable node is unavailable. Inspect the selected Pod for `runtimeClassName` and zero `subPath` mounts, and verify the Gateway and unset configuration retain their current manifests. Check the configured Codex localhost seccomp profile with Kata. A guest-kernel and QEMU observation is required before calling the installed runtime Kata-qualified; source and fixture checks alone cannot establish it.

## Tradeoffs

The conditional layout adds a second Harness mount arrangement to maintain, but limits the change to Installations that explicitly opt in. Replacing the default layout for all Harnesses would expand regression risk without helping existing Installations. Selecting a RuntimeClass without changing mounts would conflict with Kata's documented limitation. OCE cannot make a cluster class trustworthy by checking its name; the operator must verify the handler and guest VM.
