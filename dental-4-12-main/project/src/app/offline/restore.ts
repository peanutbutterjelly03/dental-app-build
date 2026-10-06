// Keep a different version of a field than the one the sync wrote, or go back to
// the original. It is sent as an ordinary new edit through the API, so the server
// audits it like any other change; nothing is rolled back behind its back.
import { apiClient, isQueuedResponse } from '../api/client';
import { recordPick } from './syncHistory';
import type { ReportRow, Version } from './syncReportModel';

/** Returns true when the change reached the server, false when it was saved on
 *  this device to sync later (the connection dropped while sending). */
export async function pickVersion(row: ReportRow, version: Version): Promise<boolean> {
  if (!row.canPick || !row.recordId || !row.fieldName) throw new Error('This change cannot be restored.');
  const result = await apiClient.put<unknown>(`/${row.resource}/${row.recordId}`, { [row.fieldName]: version.raw });
  await recordPick({ resource: row.resource, recordId: row.recordId, field: row.fieldName, picked: version.key, value: version.raw });
  return !isQueuedResponse(result);
}
