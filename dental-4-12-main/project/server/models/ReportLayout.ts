import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { softDeleteFields } from "./shared/softDelete.js";
import { REPORT_KEYS, LIMITS } from "../../shared/reportLayout.js";

// ERD deviation (right-click report tables). How one report table is LAID OUT:
// columns hidden, rows and columns added, labels renamed, and the text typed
// into the cells of added rows and columns. One document per report table,
// shared by everyone who opens it.
//
// ⚠ This is layout, never data. A figure computed from the database cannot be
// edited or overwritten through here; only labels and cells of rows/columns a
// user added are editable (decided with the user). Nothing patient-identifying
// belongs in it, so nothing is encrypted, and the caps in shared/reportLayout.ts
// keep it a small document.
const addedSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, maxlength: 64 },
    label: { type: String, required: true, maxlength: LIMITS.label },
    after: { type: String, default: null, maxlength: 64 },
  },
  { _id: false },
);

const reportLayoutSchema = new mongoose.Schema(
  {
    report_key: { type: String, required: true, enum: REPORT_KEYS },
    hidden_cols: { type: [{ type: String, maxlength: 80 }], default: [] },
    hidden_rows: { type: [{ type: String, maxlength: 80 }], default: [] },
    added_cols: { type: [addedSchema], default: [] },
    added_rows: { type: [addedSchema], default: [] },
    labels: { type: [new mongoose.Schema({ key: { type: String, maxlength: 80 }, value: { type: String, maxlength: LIMITS.label } }, { _id: false })], default: [] },
    cells: { type: [new mongoose.Schema({ row: { type: String, maxlength: 64 }, col: { type: String, maxlength: 64 }, value: { type: String, maxlength: LIMITS.cell } }, { _id: false })], default: [] },
    updated_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    ...softDeleteFields,
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

reportLayoutSchema.index({ report_key: 1, isArchived: 1 });

export default getModel("ReportLayout", reportLayoutSchema);
