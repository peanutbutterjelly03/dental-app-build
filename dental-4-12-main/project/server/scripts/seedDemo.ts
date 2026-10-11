import "dotenv/config";
import "../dnsFix.js"; // this machine's Node 24 + Atlas SRV workaround
import { connectDB } from "../config/db.js";
import { announceTarget } from "./announceTarget.js";
import { School, User, Dentist, DentalAide } from "../models/index.js";
import { hashPassword } from "../utils/password.js";
import { requireSecretEnv, requireSecretEnvAll } from "./seedEnv.js";
import mongoose from "mongoose";

const SCHOOLS = [
  {
    school_name: "Bagong Tanyag Integrated School",
    school_type: "Integrated (K-Grade 10)",
    principal_name: "TBD",
    street_address: "Bagong Tanyag",
    barangay: "Tanyag",
    city: "Taguig",
  },
  {
    school_name: "Bagong Tanyag Elementary School Annex A",
    school_type: "Elementary (K-Grade 6)",
    principal_name: "TBD",
    street_address: "Bagong Tanyag",
    barangay: "Tanyag",
    city: "Taguig",
  },
  {
    school_name: "South Daang Hari Elementary School Main",
    school_type: "Elementary (K-Grade 6)",
    principal_name: "TBD",
    street_address: "South Daang Hari",
    barangay: "Tanyag",
    city: "Taguig",
  },
];

async function ensureSchools() {
  const byName: Record<string, any> = {};
  for (const s of SCHOOLS) {
    let school = await School.findOne({ school_name: s.school_name });
    if (!school) {
      school = await School.create(s);
      console.log(`Created school: ${school.school_name}`);
    }
    byName[s.school_name] = school;
  }
  return byName;
}

/** `school_ids: []` means ALL schools (Sprint 100). */
async function ensureUser(email: string, role: string, full_name: string, password_hash: string, school_ids: any[]) {
  let user = await User.findOne({ email });
  if (user) {
    console.log(`User ${email} already exists, skipping.`);
    return user;
  }
  user = await User.create({ email, role, full_name, password_hash, school_ids });
  console.log(`Created ${role} user: ${email}`);
  return user;
}

const SEED_PASSWORD_VARS = [
  "SEED_DENTIST_PASSWORD",
  "SEED_AIDE_PASSWORD",
  "SEED_SCHOOLADMIN_PASSWORD",
  "SEED_BHO_PASSWORD",
];

const requireEnv = requireSecretEnv;

async function main() {
  // Check every password BEFORE connecting: these used to be read after
  // ensureSchools(), so a bad value left a half-seeded database behind.
  requireSecretEnvAll(SEED_PASSWORD_VARS);

  await connectDB();
  announceTarget("seedDemo");

  const schools = await ensureSchools();
  const integrated = schools["Bagong Tanyag Integrated School"];
  const annexA = schools["Bagong Tanyag Elementary School Annex A"];

  const dentistUser = await ensureUser(
    "dentist@floral.com",
    "dentist",
    "Dr. Maria Santos",
    await hashPassword(requireEnv("SEED_DENTIST_PASSWORD")),
    // One dentist serves all three schools and rotates between them
    // (DENTIST_ROTATION), so she is assigned to every school — NOT pinned to
    // Integrated as this seeder did before Sprint 100.
    [],
  );
  let dentist = await Dentist.findOne({ user_id: dentistUser._id });
  if (!dentist) {
    dentist = await Dentist.create({
      school_id: integrated._id,
      user_id: dentistUser._id,
      last_name: "Santos",
      first_name: "Maria",
      license_number: "DEMO-0001",
    });
    console.log("Created Dentist record for dentist@floral.com");
  }

  const aideUser = await ensureUser(
    "aide@floral.com",
    "dental_aide",
    "Ana Reyes",
    await hashPassword(requireEnv("SEED_AIDE_PASSWORD")),
    [], // one aide, same three schools as the dentist
  );
  const existingAide = await DentalAide.findOne({ user_id: aideUser._id });
  if (!existingAide) {
    await DentalAide.create({
      school_id: integrated._id,
      user_id: aideUser._id,
      dentist_id: dentist._id,
      last_name: "Reyes",
      first_name: "Ana",
      contact_number: "09171234567",
    });
    console.log("Created DentalAide record for aide@floral.com");
  }

  await ensureUser("schooladmin@floral.com", "school_admin", "Nurse Rosa Cruz", await hashPassword(requireEnv("SEED_SCHOOLADMIN_PASSWORD")), [annexA._id]);
  await ensureUser("bho@floral.com", "bho_staff", "Jose Santos", await hashPassword(requireEnv("SEED_BHO_PASSWORD")), []);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
