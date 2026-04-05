export function isIncomingChangeNewer(existingUpdatedAt: number, incomingUpdatedAt: number): boolean {
  return incomingUpdatedAt > existingUpdatedAt;
}

export function shouldApplyDelete(existingUpdatedAt: number, lastPulledAt?: number): boolean {
  if (lastPulledAt === undefined) {
    return true;
  }

  return existingUpdatedAt <= lastPulledAt;
}
