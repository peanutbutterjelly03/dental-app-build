import { describe, it, expect } from 'vitest';
import { describeWrite } from './describeWrite';

describe('describeWrite', () => {
  it('names an added student by name', () => {
    expect(describeWrite({ endpoint: '/students', method: 'POST', body: { last_name: 'Cruz', first_name: 'Juan' } }))
      .toEqual({ module: 'Students', kind: 'Student record added', detail: 'Cruz, Juan' });
  });
  it('puts charting writes under Dental chart and shows the tooth', () => {
    expect(describeWrite({ endpoint: '/tooth-records', method: 'POST', body: { tooth_number: 11, condition: 'Caries' } }))
      .toEqual({ module: 'Dental chart', kind: 'Tooth record added', detail: '#11: Caries' });
    expect(describeWrite({ endpoint: '/tooth-records/64b5f0c2a1b2c3d4e5f60718', method: 'PUT', body: { tooth_number: 12 } }).kind)
      .toBe('Tooth record updated');
  });
  it('reads an archive call from the endpoint, not the method', () => {
    expect(describeWrite({ endpoint: '/students/64b5f0c2a1b2c3d4e5f60718/archive', method: 'PATCH', body: undefined }))
      .toEqual({ module: 'Students', kind: 'Student record archived', detail: undefined });
  });
  it('files treatments and referrals under Treatments', () => {
    expect(describeWrite({ endpoint: '/treatments', method: 'POST', body: { treatment_done: 'Extraction' } }))
      .toEqual({ module: 'Treatments', kind: 'Treatment added', detail: 'Extraction' });
    expect(describeWrite({ endpoint: '/referrals', method: 'POST', body: {} }).module).toBe('Treatments');
  });
  it('falls back to a readable name for anything it does not know', () => {
    expect(describeWrite({ endpoint: '/dentist-rotations', method: 'POST', body: {} }))
      .toEqual({ module: 'Dentist Rotations', kind: 'Dentist Rotation added', detail: undefined });
  });
  it('ignores a query string', () => {
    expect(describeWrite({ endpoint: '/students?x=1', method: 'POST', body: {} }).kind).toBe('Student record added');
  });
});
