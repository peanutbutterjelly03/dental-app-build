// The demo student roster, in ONE place.
//
// It used to be declared in seedStudents.ts and duplicated as a name list in
// purgeDemoData.ts. They drifted: Sprint 45 added the eight Grade 7-10 pupils
// to the seeder on 2026-09-01, the purge's copy was written 2026-08-11 and
// never updated, so a purge would have deleted all three SCHOOLS and the demo
// staff while leaving those eight students behind pointing at schools that no
// longer existed. Found by the first dry run (2026-09-02).
//
// Both scripts now derive from this array, so the two can never disagree
// again. seedStudents.ts cannot simply be imported by the purge -- it calls
// main() at module scope, so importing it would RUN the seeder.
export const DEMO_STUDENTS = [
  // Bagong Tanyag Integrated School
  { school: "Bagong Tanyag Integrated School", full_name: "Juan Morales", birthday: "2020-07-23", sex: "Male", grade_level: "Grade 1", section: "Sampaguita", risk: "Low" },
  { school: "Bagong Tanyag Integrated School", full_name: "Isabella Villanueva", birthday: "2020-08-07", sex: "Female", grade_level: "Grade 1", section: "Sampaguita", risk: "Medium" },
  { school: "Bagong Tanyag Integrated School", full_name: "Aldrin Villanueva", birthday: "2018-11-22", sex: "Male", grade_level: "Grade 3", section: "Jasmine", risk: "High" },
  { school: "Bagong Tanyag Integrated School", full_name: "Elena Morales", birthday: "2018-10-10", sex: "Female", grade_level: "Grade 3", section: "Jasmine", risk: "Low" },
  { school: "Bagong Tanyag Integrated School", full_name: "Trisha Santos", birthday: "2016-01-27", sex: "Female", grade_level: "Grade 5", section: "Rose", risk: "High" },
  { school: "Bagong Tanyag Integrated School", full_name: "Katrina Lopez", birthday: "2016-12-23", sex: "Female", grade_level: "Grade 5", section: "Rose", risk: null }, // not yet screened
  // Bagong Tanyag Elementary School Annex A
  { school: "Bagong Tanyag Elementary School Annex A", full_name: "Ana Reyes Jr.", birthday: "2019-11-11", sex: "Female", grade_level: "Grade 2", section: "Dahlia", risk: "High" },
  { school: "Bagong Tanyag Elementary School Annex A", full_name: "Patricia Garcia", birthday: "2019-01-03", sex: "Female", grade_level: "Grade 2", section: "Dahlia", risk: "Medium" },
  { school: "Bagong Tanyag Elementary School Annex A", full_name: "Nico Castillo", birthday: "2017-02-17", sex: "Male", grade_level: "Grade 4", section: "Garnet", risk: "Low" },
  { school: "Bagong Tanyag Elementary School Annex A", full_name: "Marco Navarro", birthday: "2017-07-07", sex: "Male", grade_level: "Grade 4", section: "Garnet", risk: "High" },
  { school: "Bagong Tanyag Elementary School Annex A", full_name: "Ivan Villanueva", birthday: "2015-06-24", sex: "Male", grade_level: "Grade 6", section: "Topaz", risk: null },
  { school: "Bagong Tanyag Elementary School Annex A", full_name: "Jomar Diaz", birthday: "2015-08-24", sex: "Male", grade_level: "Grade 6", section: "Topaz", risk: "Medium" },
  // South Daang Hari Elementary School Main
  { school: "South Daang Hari Elementary School Main", full_name: "Patricia Castillo", birthday: "2019-12-25", sex: "Female", grade_level: "Grade 2", section: "Yakal", risk: "Low" },
  { school: "South Daang Hari Elementary School Main", full_name: "Patricia Magno", birthday: "2019-07-26", sex: "Female", grade_level: "Grade 2", section: "Yakal", risk: "Medium" },
  { school: "South Daang Hari Elementary School Main", full_name: "Bea Castillo", birthday: "2017-01-25", sex: "Female", grade_level: "Grade 4", section: "Coral", risk: "High" },
  { school: "South Daang Hari Elementary School Main", full_name: "Alyssa Martinez", birthday: "2017-02-07", sex: "Female", grade_level: "Grade 4", section: "Coral", risk: "Low" },
  { school: "South Daang Hari Elementary School Main", full_name: "Angel Bautista", birthday: "2015-04-24", sex: "Female", grade_level: "Grade 6", section: "Sunflower", risk: null },
  { school: "South Daang Hari Elementary School Main", full_name: "Celine Morales", birthday: "2015-08-12", sex: "Female", grade_level: "Grade 6", section: "Sunflower", risk: "Medium" },
  // Secondary — Bagong Tanyag Integrated School ONLY. It is the one school
  // with a high school section (K-G10); the other two stop at Grade 6, which
  // is why the DOH report's Grade 7-10 band hides itself for them.
  //
  // Added 2026-09-01: without these the Grade 7-10 DOH band could never be
  // rendered at all, so Sprint 41's secondary report was undemoable and its
  // age brackets unverifiable. Birthdays are chosen to land in BOTH secondary
  // brackets — Grades 7-9 fall in "10-14 yrs", Grade 10 in "15-19 yrs" — so
  // the report exercises more than one age column instead of stacking
  // everyone into one.
  //
  // dmf_index is "DMF" (uppercase) for these: secondary pupils are assessed
  // on PERMANENT dentition, and the DOH table counts DMF_total separately
  // from the primary-teeth dmf_df row. The elementary records above stay
  // lowercase "dmf".
  { school: "Bagong Tanyag Integrated School", full_name: "Miguel Bonifacio", birthday: "2014-03-14", sex: "Male", grade_level: "Grade 7", section: "Rizal", risk: "Medium", dmf_index: "DMF" },
  { school: "Bagong Tanyag Integrated School", full_name: "Sofia Delacruz", birthday: "2014-09-02", sex: "Female", grade_level: "Grade 7", section: "Rizal", risk: "Low", dmf_index: "DMF" },
  { school: "Bagong Tanyag Integrated School", full_name: "Rafael Aquino", birthday: "2013-05-30", sex: "Male", grade_level: "Grade 8", section: "Mabini", risk: "High", dmf_index: "DMF" },
  { school: "Bagong Tanyag Integrated School", full_name: "Clarisse Ocampo", birthday: "2013-11-18", sex: "Female", grade_level: "Grade 8", section: "Mabini", risk: null },
  { school: "Bagong Tanyag Integrated School", full_name: "Diego Salazar", birthday: "2012-02-09", sex: "Male", grade_level: "Grade 9", section: "Luna", risk: "Medium", dmf_index: "DMF" },
  { school: "Bagong Tanyag Integrated School", full_name: "Andrea Pascual", birthday: "2012-08-25", sex: "Female", grade_level: "Grade 9", section: "Luna", risk: "High", dmf_index: "DMF" },
  { school: "Bagong Tanyag Integrated School", full_name: "Joshua Fernandez", birthday: "2011-01-16", sex: "Male", grade_level: "Grade 10", section: "Del Pilar", risk: "Low", dmf_index: "DMF" },
  { school: "Bagong Tanyag Integrated School", full_name: "Bianca Ramirez", birthday: "2011-06-04", sex: "Female", grade_level: "Grade 10", section: "Del Pilar", risk: "Medium", dmf_index: "DMF" },
];

/** Exact full names the purge matches on. Derived, never hand-maintained. */
export const DEMO_STUDENT_NAMES = new Set(DEMO_STUDENTS.map((s) => s.full_name));
