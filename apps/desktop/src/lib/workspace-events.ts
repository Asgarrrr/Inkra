import type identityContract from "@shared/workspace-identity.contract.json";

export type WorkspaceIdentity = typeof identityContract;

export function isWorkspaceEventCurrent(
  eventWorkspace: WorkspaceIdentity | null,
  currentWorkspace: WorkspaceIdentity | null,
) {
  return (
    eventWorkspace === null ||
    (currentWorkspace !== null &&
      eventWorkspace.root === currentWorkspace.root &&
      eventWorkspace.epoch === currentWorkspace.epoch)
  );
}
