import { describe, it, expect } from "vitest";
import { takeSync, conflictingFields, canon } from "./syncConflict";

describe("takeSync", () => {
  it("removes _sync from the body so it can never be stored, and returns it", () => {
    const body: Record<string, unknown> = { section: "B", _sync: { operationId: "11111111-2222-3333-4444-555555555555", base: { section: "A" } } };
    expect(takeSync(body)).toEqual({ operationId: "11111111-2222-3333-4444-555555555555", base: { section: "A" } });
    expect(body).toEqual({ section: "B" });
  });
  it("ignores a malformed envelope instead of failing the save", () => {
    for (const _sync of ["x", 5, null, {}, { operationId: "short" }, { operationId: "bad id with spaces!!" }, { operationId: 7 }]) {
      const body: Record<string, unknown> = { a: 1, _sync };
      expect(takeSync(body)).toBeNull();
      expect(body).toEqual({ a: 1 });
    }
  });
  it("treats a missing or oversized base as 'no starting values' rather than rejecting", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    expect(takeSync({ _sync: { operationId: id } })?.base).toEqual({});
    expect(takeSync({ _sync: { operationId: id, base: [1] } })?.base).toEqual({});
    const huge = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, i]));
    expect(takeSync({ _sync: { operationId: id, base: huge } })?.base).toEqual({});
  });
});

describe("canon", () => {
  it("makes a date-only string and a full ISO instant of the same day equal", () => {
    expect(canon("2015-03-04")).toBe(canon("2015-03-04T00:00:00.000Z"));
  });
  it("treats undefined and null alike, and sorts object keys", () => {
    expect(canon(undefined)).toBeNull();
    expect(JSON.stringify(canon({ b: 1, a: 2 }))).toBe('{"a":2,"b":1}');
  });
});

describe("conflictingFields", () => {
  const base = { section: "A", grade_level: "Grade 3", birthday: "2015-03-04" };
  it("flags a field someone else changed that this edit would overwrite", () => {
    expect(conflictingFields(base, { section: "B" }, { section: "C", grade_level: "Grade 3" })).toEqual(["section"]);
  });
  it("is not a conflict when nobody else touched the field", () => {
    expect(conflictingFields(base, { section: "B" }, { section: "A" })).toEqual([]);
  });
  it("is not a conflict when the server already holds what this edit writes (a replay, or both agree)", () => {
    expect(conflictingFields(base, { section: "B" }, { section: "B" })).toEqual([]);
  });
  it("ignores fields the device sent no starting value for", () => {
    expect(conflictingFields({ section: "A" }, { section: "B", address: "X" }, { section: "A", address: "Y" })).toEqual([]);
  });
  it("compares dates by value, not by how they were written", () => {
    expect(conflictingFields({ birthday: "2015-03-04" }, { birthday: "2015-03-04" }, { birthday: "2015-03-04T00:00:00.000Z" })).toEqual([]);
    expect(conflictingFields({ birthday: "2015-03-04" }, { birthday: "2015-05-06" }, { birthday: "2015-03-09T00:00:00.000Z" })).toEqual(["birthday"]);
  });
  it("reports every clashing field, and only those", () => {
    expect(conflictingFields(base, { section: "B", grade_level: "Grade 4" }, { section: "C", grade_level: "Grade 5" }).sort()).toEqual(["grade_level", "section"]);
  });
});
