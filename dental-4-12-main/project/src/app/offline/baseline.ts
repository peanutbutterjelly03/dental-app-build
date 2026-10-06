// The starting values a queued edit is checked against at sync time.
//
// A device that edits the same record twice while offline queues two writes, and
// they reach the server one after the other. The second must start from what the
// FIRST will have written, not from the server copy the device cached earlier:
// otherwise, by the time it arrives, the server holds the first edit's value, it
// looks like someone else changed the field, and the device clashes with itself.
//
// Pure, so it is tested without IndexedDB.

/** Values for `fields`, as they will stand on the server when this edit arrives:
 *  the cached server copy, overlaid with every earlier still-queued edit of the
 *  same record, oldest first. */
export function chainBaseline(
  serverCopy: Record<string, unknown> | undefined,
  earlierBodies: unknown[],
): Record<string, unknown> | undefined {
  if (!serverCopy) return undefined;
  const chained: Record<string, unknown> = { ...serverCopy };
  for (const body of earlierBodies) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) continue;
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (!key.startsWith('_')) chained[key] = value;
    }
  }
  return chained;
}
