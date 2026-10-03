import "dotenv/config";
import { connectDB } from "../config/db.js";
import { User } from "../models/index.js";
import mongoose from "mongoose";

// Recovery script: reactivate (un-archive) System Admin accounts. login()
// rejects isArchived users, so a System Admin who was accidentally deactivated
// can no longer sign in — and seedAdmin skips them because the email still
// exists. Run this to get back in:  npm run restore:admin
async function main() {
  await connectDB();

  const archived = await User.find({ role: "system_admin", isArchived: true }).select("email");
  if (archived.length === 0) {
    console.log("No archived system_admin accounts found — nothing to restore.");
    await mongoose.disconnect();
    return;
  }

  await User.updateMany(
    { role: "system_admin", isArchived: true },
    { $set: { isArchived: false, archivedAt: null, archivedBy: null } },
  );

  for (const a of archived) console.log(`Reactivated system_admin: ${a.email} (${a._id})`);
  console.log(`Done — ${archived.length} admin account(s) reactivated. You can log in now.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
