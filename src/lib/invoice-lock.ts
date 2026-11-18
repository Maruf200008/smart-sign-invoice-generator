/** A device holds an invoice's edit lock while it keeps refreshing it; it lapses this long after the last refresh. */
export const ACTIVE_LOCK_MS = 30_000;

export interface InvoiceLockColumns {
  lock_client_id: string | null;
  lock_touched_at: string | null;
}

/** True when another device refreshed the lock recently. */
export function isLockedByOther(row: InvoiceLockColumns | undefined, clientId: string, now = Date.now()) {
  if (!row?.lock_client_id || row.lock_client_id === clientId || !row.lock_touched_at) {
    return false;
  }

  const touchedAt = Date.parse(row.lock_touched_at);
  return Number.isFinite(touchedAt) && now - touchedAt < ACTIVE_LOCK_MS;
}

/**
 * PostgREST filter matching rows this device may modify: unlocked, locked by itself, or a lapsed lock.
 * `clientId` must already be validated (alphanumeric and dashes only) because it is embedded in the filter.
 */
export function writableByFilter(clientId: string, now = Date.now()) {
  if (!/^[A-Za-z0-9-]+$/.test(clientId)) {
    throw new Error("Invalid client id.");
  }

  const lapsedBefore = new Date(now - ACTIVE_LOCK_MS).toISOString();
  return `or=(lock_client_id.is.null,lock_client_id.eq.${clientId},lock_touched_at.is.null,lock_touched_at.lt."${lapsedBefore}")`;
}
