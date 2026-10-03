// Sprint 47 — exercises findDuplicateStudents against the real database.
// READ-ONLY: it creates nothing and writes nothing.
//   npx tsx verify_duplicate_students.ts
//
// Case 9 is the useful one to re-run later: it reports duplicate students that
// are ALREADY in the database. This sprint only warns at entry, so anything it
// lists there predates the guard and has to be dealt with by hand.
import "./server/dnsFix.js";
import "dotenv/config";
import { connectDB } from "./server/config/db.js";
import Student from "./server/models/Student.js";
import { findDuplicateStudents } from "./server/utils/studentDuplicates.js";
import mongoose from "mongoose";

const count = async (body: Record<string, unknown>) => (await findDuplicateStudents(body)).length;
const check = (label: string, got: number, pass: boolean) =>
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(26)} -> ${got}`);

async function main() {
  await connectDB();
  const all = await Student.find({ isArchived: false });
  console.log(`Active students: ${all.length}\n`);
  if (all.length === 0) return;

  const s: any = all[0];
  console.log(`Probe: "${s.full_name}" | ${s.grade_level} ${s.section} | ${s.birthday.toISOString().slice(0, 10)}\n`);

  const base = {
    school_id: s.school_id.toString(),
    birthday: s.birthday.toISOString(),
    last_name: s.last_name,
    first_name: s.first_name,
  };

  let n: number;
  n = await count(base);
  check("exact re-add", n, n >= 1);

  n = await count({ ...base, last_name: `  ${String(s.last_name).toUpperCase()} `, first_name: String(s.first_name).toLowerCase() });
  check("case/whitespace noise", n, n >= 1);

  // what the add form actually sends
  n = await count({ ...base, birthday: s.birthday.toISOString().slice(0, 10) });
  check("date-only birthday", n, n >= 1);

  n = await count({ ...base, middle_name: "Zzzqqx" });
  check("middle name ignored", n, n >= 1);

  n = await count({ ...base, last_name: "Zzzqqx" });
  check("different surname", n, n === 0);

  n = await count({ ...base, birthday: "1999-01-02" });
  check("different birthday", n, n === 0);

  n = await count({ ...base, school_id: new mongoose.Types.ObjectId().toString() });
  check("different school", n, n === 0);

  n = await count({ ...base, first_name: "" });
  check("missing first name", n, n === 0);

  // Existing duplicates — same key the server uses.
  const seen = new Map<string, string[]>();
  for (const st of all as any[]) {
    const key = [
      st.school_id,
      st.birthday.toISOString().slice(0, 10),
      String(st.last_name).normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().replace(/\s+/g, " ").trim(),
      String(st.first_name).normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().replace(/\s+/g, " ").trim(),
    ].join("|");
    seen.set(key, [...(seen.get(key) ?? []), st.full_name]);
  }
  const dupes = [...seen.values()].filter((v) => v.length > 1);
  console.log(`\nDuplicate groups already in the database: ${dupes.length}`);
  dupes.forEach((d) => console.log(`   - ${d.join("  /  ")}`));
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
