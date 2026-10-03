import mongoose from "mongoose";

export const softDeleteFields = {
  isArchived: { type: Boolean, default: false },
  archivedAt: { type: Date, default: null },
  archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
};
