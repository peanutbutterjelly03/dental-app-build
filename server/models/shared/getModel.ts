import mongoose, { type Schema, type Model } from "mongoose";

// `mongoose.models.X || mongoose.model("X", schema)` (repeated in every model
// file to avoid OverwriteModelError on hot-reload/re-import) infers as a union
// of two structurally-similar Model types whose overloaded methods don't
// resolve cleanly — a regression surfaced by the mongoose 8.24 bump (Sprint
// 15.5 dependency security fix). Centralizing the pattern here with an
// explicit Model<any> return type fixes it everywhere at once.
export function getModel(name: string, schema: Schema): Model<any> {
  return (mongoose.models[name] as Model<any>) || mongoose.model(name, schema);
}
