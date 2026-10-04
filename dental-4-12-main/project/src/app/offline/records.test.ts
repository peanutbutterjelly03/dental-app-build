import { describe, it, expect } from 'vitest';
import { planFor, toOfflineRecord, recordKey, fkKey } from './records';

const ID = '64b5f0c2a1b2c3d4e5f60718';
const ID2 = '64b5f0c2a1b2c3d4e5f60719';

describe('planFor', () => {
  it('answers one record by id', () => {
    expect(planFor(`/students/${ID}`)).toEqual({ kind: 'single', resource: 'students', id: ID });
    expect(planFor(`/student-iptrs/${ID}`)).toEqual({ kind: 'single', resource: 'student-iptrs', id: ID });
  });
  it('answers a list filtered by the field that resource is looked up by, one id or several', () => {
    expect(planFor(`/student-iptrs?student_id=${ID}`)).toEqual({ kind: 'list', resource: 'student-iptrs', field: 'student_id', values: [ID] });
    expect(planFor(`/tooth-records?chart_id=${ID},${ID2}`)).toEqual({ kind: 'list', resource: 'tooth-records', field: 'chart_id', values: [ID, ID2] });
    expect(planFor(`/medical-histories?iptr_id=${ID}`)?.kind).toBe('list');
  });
  it('does not answer anything it cannot answer with confidence', () => {
    for (const p of [
      '/students',                                  // an unfiltered list
      `/student-iptrs?grade=3`,                     // a filter that is not its lookup field
      `/tooth-records?iptr_id=${ID}`,               // the wrong lookup field for that resource
      `/student-iptrs?student_id=pending-4`,        // a record that exists only on this device
      `/student-iptrs?student_id=${ID}&limit=5`.replace('&limit=5', '&x=1'),
      `/appointments?student_id=${ID}`,             // not held record by record
      '/stats/student-rows',
    ]) expect(planFor(p), p).toBeNull();
  });
  it('ignores shaping parameters like limit', () => {
    expect(planFor(`/student-iptrs?student_id=${ID}&limit=5`)?.kind).toBe('list');
  });
});

describe('toOfflineRecord', () => {
  it('keys a record by owner, resource and id, and indexes it by its parent', () => {
    const rec = toOfflineRecord('u1', 'tooth-records', { _id: ID, chart_id: ID2, tooth_number: 11 }, 'run-1');
    expect(rec).toMatchObject({ key: recordKey('u1', 'tooth-records', ID), ownerKey: 'u1', resource: 'tooth-records', id: ID, run: 'run-1' });
    expect(rec?.fk).toEqual([fkKey('u1', 'tooth-records', 'chart_id', ID2)]);
  });
  it('gives a student no parent index (it is looked up by id only)', () => {
    expect(toOfflineRecord('u1', 'students', { _id: ID }, 'r')?.fk).toEqual([]);
  });
  it('keeps one user\'s records apart from another\'s', () => {
    expect(recordKey('u1', 'students', ID)).not.toBe(recordKey('u2', 'students', ID));
    expect(fkKey('u1', 'tooth-records', 'chart_id', ID)).not.toBe(fkKey('u2', 'tooth-records', 'chart_id', ID));
  });
  it('skips anything without an id', () => {
    expect(toOfflineRecord('u1', 'students', { name: 'x' }, 'r')).toBeNull();
    expect(toOfflineRecord('u1', 'students', null, 'r')).toBeNull();
  });
});
