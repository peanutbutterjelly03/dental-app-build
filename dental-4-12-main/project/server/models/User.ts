import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { softDeleteFields } from "./shared/softDelete.js";

export const ROLES = ["system_admin", "dentist", "dental_aide", "school_admin", "bho_staff"] as const;

const userSchema = new mongoose.Schema(
  {
    // ERD deviation (Sprint 100): the Chapter 3 ERD gives USER a single
    // `school_id`, which cannot express the real staffing — one dentist and one
    // aide rotate across all three schools, and the user confirmed other roles
    // may cover several too. EMPTY ARRAY MEANS ALL SCHOOLS: that keeps
    // system_admin and bho_staff working exactly as the old `school_id: null`
    // did, with one rule instead of a per-role special case.
    school_ids: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "School" }], default: [] },
    role: { type: String, enum: ROLES, required: true },
    full_name: { type: String, required: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Invalid email format"],
    },
    password_hash: { type: String, required: true, select: false },
    is_enrolled: { type: Boolean, default: false },
    last_login: { type: Date, default: null },
    // ERD deviation (Sprint 25, like email/password_hash before): email 2FA +
    // self-service reset. Only hashes are stored — never plaintext codes/tokens.
    twofa_enabled: { type: Boolean, default: false },
    otp_hash: { type: String, default: null, select: false },
    otp_expires: { type: Date, default: null },
    reset_token_hash: { type: String, default: null, select: false },
    reset_token_expires: { type: Date, default: null },
    ...softDeleteFields,
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

export default getModel("User", userSchema);
