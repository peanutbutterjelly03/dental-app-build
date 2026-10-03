import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { logAudit } from "../utils/auditLog.js";

// Proxy to the Python ML service (FastAPI wrapping predictor.py — the sole
// entry point per CLAUDE.md; Express never touches algorithm files). The
// service URL/key come from env so local dev (localhost:8000) and production
// (Render) need no code change.
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";
const ML_SERVICE_API_KEY = process.env.ML_SERVICE_API_KEY || "";

// Only dentists use the risk UI (Sprint 21f spec); System Admin included as
// the super user, consistent with every other clinical permission.
const PREDICTION_ROLES = ["dentist", "system_admin"];

const FEATURE_KEYS = [
  "dmf_score", "decayed_count", "missing_count", "filled_count",
  "gingivitis", "periodontal_disease", "debris", "calculus",
  "abnormal_growth", "sugar_beverages", "tobacco_user", "age", "sex",
] as const;

const router = Router();

// Model/service status — the UI shows the model's honesty banner from this
// (algorithm, trained_at, synthetic_data flag) and its "service unavailable"
// state when the ML service can't be reached.
router.get(
  "/status",
  requireAuth,
  requireRole(...PREDICTION_ROLES),
  asyncHandler(async (_req, res) => {
    try {
      const r = await fetch(`${ML_SERVICE_URL}/health`, {
        signal: AbortSignal.timeout(8000),
      });
      res.json(await r.json());
    } catch {
      res.status(503).json({ error: "Prediction service unavailable" });
    }
  })
);

router.post(
  "/assess",
  requireAuth,
  requireRole(...PREDICTION_ROLES),
  asyncHandler(async (req, res) => {
    const { student_id, features } = req.body ?? {};
    if (!student_id || typeof features !== "object" || features === null) {
      res.status(400).json({ error: "student_id and features are required" });
      return;
    }
    // pass through only the known feature keys; FastAPI does strict
    // range validation on its side
    const body: Record<string, unknown> = {};
    for (const k of FEATURE_KEYS) body[k] = features[k];

    let r: Response;
    try {
      r = await fetch(`${ML_SERVICE_URL}/predict`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(ML_SERVICE_API_KEY ? { "X-API-Key": ML_SERVICE_API_KEY } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000), // Render free tier cold starts are slow
      });
    } catch {
      res.status(503).json({ error: "Prediction service unavailable" });
      return;
    }
    const result = await r.json();
    if (!r.ok) {
      res.status(502).json({ error: "Prediction service rejected the request", detail: result });
      return;
    }
    // every generated assessment is audit-logged (Sprint 21f spec), tied to
    // the student it was generated for
    void logAudit(req.user!.id, "Generated Risk Prediction", String(student_id), "RiskStratification");
    res.json(result);
  })
);

export default router;
