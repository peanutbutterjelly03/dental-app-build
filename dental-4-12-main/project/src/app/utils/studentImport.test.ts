// 2026-10-04: the clinic's encoded workbook ("Raw Copy of Manual Encoded")
// extracted NOTHING: its column names are on row 2 (row 1 holds group titles),
// they carry notes like "(dd/mm//yyyy)", and birthdays are day-first. Verified
// locally on the real workbook (never committed): 18/18 rows with names, sex,
// grade, section and a birthday whose age matches the file's own Age column.

import { describe, it, expect } from 'vitest';
import { normalizeHeader, findHeaderRow, toIsoDate } from './studentImport';

describe('spreadsheet header names', () => {
  it('drops bracketed notes and punctuation', () => {
    expect(normalizeHeader('Date of Birth (dd/mm//yyyy)')).toBe('date_of_birth');
    expect(normalizeHeader('Middle Initial')).toBe('middle_initial');
    expect(normalizeHeader(' Last Name ')).toBe('last_name');
    expect(normalizeHeader('Contact #')).toBe('contact');
  });

  it('finds the header row below a row of group titles', () => {
    const rows = [
      ['', '', 'Date of Examination', 'Medical History'],
      ['School', 'Grade', 'Section', 'Surname', 'First Name', 'Sex'],
      ['BTIS', 'Grade 1', 'Rose', 'Cruz', 'Ana', 'F'],
    ];
    expect(findHeaderRow(rows)).toBe(1);
  });

  it('a plain one-row header is still row 1', () => {
    expect(findHeaderRow([['last_name', 'first_name', 'birthday'], ['Cruz', 'Ana', '2018-01-02']])).toBe(0);
  });
});

describe('birthdays', () => {
  it('reads a day-first column as day-first', () => {
    expect(toIsoDate('11/01/2019', true)).toBe('2019-01-11');
  });
  it('without the hint, a day above 12 settles it; otherwise month-first', () => {
    expect(toIsoDate('25/12/2018', false)).toBe('2018-12-25');
    expect(toIsoDate('01/11/2019', false)).toBe('2019-01-11');
  });
  it('leaves ISO dates and unreadable text alone', () => {
    expect(toIsoDate('2019-01-11', false)).toBe('2019-01-11');
    expect(toIsoDate('Jan 11 2019', false)).toBe('Jan 11 2019');
    expect(toIsoDate('31/31/2019', true)).toBe('31/31/2019');
  });
});
