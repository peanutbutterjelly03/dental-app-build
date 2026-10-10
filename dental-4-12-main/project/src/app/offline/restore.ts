// Keep a different version of a field than the one the sync wrote, or go back to
// the original. It is sent as an ordinary new edit through the API, so the server
// audits it like any other change; nothing is rolled back behind its back.
import { apiClient, isQueuedResponse } from '../api/client';
import { recordPick } from './syncHistory';
import { RECORD_FIELD, type ReportRow, type Version } from './syncReportModel';

/** Returns true when the change reached the server, false when it was saved on
 *  this device to sync later (the connection dropped while sending). */
export async function pickVersion(row: ReportRow, version: Version): Promise<boolean> {
  if (!row.canPick || !row.recordId || !row.fieldName) throw new Error('This change cannot be restored.');
  const result = await apiClient.put<unknown>(`/${row.resource}/${row.recordId}`, { [row.fieldName]: version.raw });
  await recordPick({ resource: row.resource, recordId: row.recordId, field: row.fieldName, picked: version.key, value: version.raw });
  return !isQueuedResponse(result);
}

/** Put one change back to what it was, whatever kind it is. An edit sends its original
 *  value again; a record that was ADDED is archived (never deleted); a tooth that was
 *  CLEARED is added again as a new record. Each goes through the API like any other
 *  change, so the server audits it. Returns true when it reached the server. */
export async function restoreRow(row: ReportRow): Promise<boolean> {
  if (row.restore === 'pick') return pickVersion(row, row.versions[0]);
  if (!row.recordId) throw new Error('This change cannot be restored.');
  if (row.restore === 'undo-create') {
    const result = await apiClient.patch<unknown>(`/${row.resource}/${row.recordId}/archive`);
    await recordPick({ resource: row.resource, recordId: row.recordId, field: RECORD_FIELD, picked: 'undone', value: null });
    return !isQueuedResponse(result);
  }
  if (row.restore === 'recreate') {
    const was = Object.fromEntries((row.detail ?? []).map((f) => [f.field, f.before]));
    const result = await apiClient.post<unknown>(`/${row.resource}`, {
      chart_id: was.chart_id, tooth_number: was.tooth_number, condition: was.condition,
      treatment_code: was.treatment_code ?? '', ...(was.visit_number !== undefined ? { visit_number: was.visit_number } : {}),
    });
    await recordPick({ resource: row.resource, recordId: row.recordId, field: RECORD_FIELD, picked: 'recreated', value: null });
    return !isQueuedResponse(result);
  }
  throw new Error('This change cannot be restored.');
}
