import type { Request, Response } from "express";
import mongoose from "mongoose";

export function getHealth(_req: Request, res: Response) {
  const dbStates = ["disconnected", "connected", "connecting", "disconnecting"];
  res.json({
    status: "ok",
    db: dbStates[mongoose.connection.readyState],
  });
}
