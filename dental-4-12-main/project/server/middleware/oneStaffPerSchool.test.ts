import { describe, it, expect, vi, beforeEach } from "vitest";

// The models are replaced with small fakes so the rule can be checked without a
// database: `stored` is the account being edited, `others` what the "same role
// on one of these schools" query returns.
const state = vi.hoisted(() => ({
  stored: null as null | { role: string; school_ids: string[] },
  others: [] as { full_name: string; school_ids: string[] }[],
  lastQuery: null as unknown,
}));

vi.mock("../models/index.js", () => ({
  User: {
    findById: () => ({ select: () => ({ lean: async () => state.stored }) }),
    find: (q: unknown) => { state.lastQuery = q; return { select: () => ({ lean: async () => state.others }) }; },
  },
  School: {
    find: () => ({ select: () => ({ lean: async () => [{ _id: "aaaaaaaaaaaaaaaaaaaaaaaa", school_name: "Bagong Tanyag Highschool" }] }) }),
  },
}));

import { enforceOneStaffPerSchool } from "./oneStaffPerSchool.js";

const SCHOOL = "aaaaaaaaaaaaaaaaaaaaaaaa";
const USER = "bbbbbbbbbbbbbbbbbbbbbbbb";

const run = async (req: { params?: Record<string, string>; body?: unknown }) => {
  const next = vi.fn();
  const json = vi.fn();
  const res = { status: vi.fn(() => ({ json })) };
  await enforceOneStaffPerSchool({ params: {}, body: {}, ...req } as never, res as never, next);
  return { next, json, status: res.status };
};

describe("enforceOneStaffPerSchool", () => {
  beforeEach(() => { state.stored = null; state.others = []; state.lastQuery = null; });

  it("refuses a second dentist on a school that already has one", async () => {
    state.stored = { role: "dentist", school_ids: [] };
    state.others = [{ full_name: "Dr. Maria Santos", school_ids: [SCHOOL] }];
    const r = await run({ params: { id: USER }, body: { school_ids: [SCHOOL] } });
    expect(r.next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(409);
    expect(r.json.mock.calls[0][0].error).toBe("Bagong Tanyag Highschool already has a dentist: Dr. Maria Santos.");
  });

  it("names a dental aide as a dental aide", async () => {
    state.others = [{ full_name: "Ana Reyes", school_ids: [SCHOOL] }];
    const r = await run({ body: { role: "dental_aide", school_ids: [SCHOOL] } });
    expect(r.json.mock.calls[0][0].error).toContain("already has a dental aide: Ana Reyes.");
  });

  it("lets the save through when nobody else holds the school", async () => {
    state.stored = { role: "dentist", school_ids: [] };
    const r = await run({ params: { id: USER }, body: { school_ids: [SCHOOL] } });
    expect(r.next).toHaveBeenCalled();
  });

  it("does not judge an account with an empty school list (all schools)", async () => {
    state.stored = { role: "dentist", school_ids: [] };
    state.others = [{ full_name: "Dr. Maria Santos", school_ids: [SCHOOL] }];
    const r = await run({ params: { id: USER }, body: { full_name: "New Name" } });
    expect(r.next).toHaveBeenCalled();
  });

  it("ignores roles other than dentist and dental aide", async () => {
    state.others = [{ full_name: "Someone", school_ids: [SCHOOL] }];
    const r = await run({ body: { role: "school_admin", school_ids: [SCHOOL] } });
    expect(r.next).toHaveBeenCalled();
  });

  it("checks the stored schools when a restore or role change sends no school list", async () => {
    state.stored = { role: "dentist", school_ids: [SCHOOL] };
    state.others = [{ full_name: "Dr. Maria Santos", school_ids: [SCHOOL] }];
    const r = await run({ params: { id: USER }, body: {} });
    expect(r.status).toHaveBeenCalledWith(409);
  });

  it("excludes the account being edited and archived accounts from the clash search", async () => {
    state.stored = { role: "dentist", school_ids: [] };
    await run({ params: { id: USER }, body: { school_ids: [SCHOOL] } });
    expect(state.lastQuery).toMatchObject({ _id: { $ne: USER }, isArchived: { $ne: true }, role: "dentist" });
  });
});
