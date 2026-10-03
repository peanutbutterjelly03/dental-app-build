// Which queued (not yet synced) writes touch a given record? Pure, so the rule
// the Dental Chart's save-guard depends on is testable without a browser.
interface Queued {
  endpoint: string;
  body: unknown;
}

/** The charting resources: every row the Save button on the chart writes. */
export const CHART_RESOURCES = [
  'student-iptrs',
  'dental-charts',
  'tooth-records',
  'medical-histories',
  'dietary-social-habits',
  'oral-health-conditions',
  'preventive-care-records',
];

const resourceOf = (endpoint: string) => endpoint.split('?')[0].split('/').filter(Boolean)[0] ?? '';

/** Queued writes that mention any of `ids` (in the endpoint or anywhere in the
 *  body), optionally limited to some resources. */
export function unsyncedWritesFor<T extends Queued>(queue: T[], ids: string[], resources?: string[]): T[] {
  const wanted = ids.filter(Boolean);
  if (wanted.length === 0) return [];
  return queue.filter((w) => {
    if (resources && !resources.includes(resourceOf(w.endpoint))) return false;
    const haystack = `${w.endpoint} ${JSON.stringify(w.body ?? '')}`;
    return wanted.some((id) => haystack.includes(id));
  });
}
