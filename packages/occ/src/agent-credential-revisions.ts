import type { Agent, AgentRevision } from "@openclaw-enterprise/contracts";
import { DependencyUnavailableError } from "./errors.ts";
import type { PlatformReadView } from "./state/platform-state.ts";

/** Revisions that can still use credentials while the draft changes. */
export async function retainedAgentCredentialRevisions(
  state: PlatformReadView,
  agent: Readonly<Agent>,
): Promise<readonly Readonly<AgentRevision>[]> {
  const retained: Readonly<AgentRevision>[] = [];
  const metadata = await state.revisions.listRevisionMetadata(agent.namespaceId, agent.id);
  for (const candidate of metadata) {
    const work = await state.operations.findWork(`agent_revision:${candidate.id}:reconcile`);
    if (
      candidate.id !== agent.activeRevisionId &&
      work?.state !== "queued" &&
      work?.state !== "claimed"
    ) {
      continue;
    }
    const revision = await state.revisions.findRevision(agent.namespaceId, agent.id, candidate.id);
    if (revision === undefined) {
      throw new DependencyUnavailableError("A retained Agent revision is unavailable.");
    }
    retained.push(revision);
  }
  if (
    agent.activeRevisionId !== undefined &&
    !retained.some(({ id }) => id === agent.activeRevisionId)
  ) {
    throw new DependencyUnavailableError("The Agent's active revision is unavailable.");
  }
  return retained;
}
