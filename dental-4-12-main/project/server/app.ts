import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { connectDB } from "./config/db.js";
import { checkStartupSecrets } from "./utils/secretGuard.js";
import routes from "./routes/index.js";

// Runs on every boot — local and Vercel both enter through this file. Warns
// (never throws) when a secret is missing or still an .env.example
// placeholder. It is also the loud version of the Sprint 111 trap: a bad
// MONGODB_URI does not stop app.listen(), so the boot used to look perfectly
// healthy while every request 500'd.
checkStartupSecrets();

const app = express();

// This server only ever returns JSON (the React app is served separately —
// directly by Vite in dev, or as static files via the Vercel rewrite in
// production) — helmet's default CSP/HSTS/etc. are safe to apply as-is
// since there's no HTML response here for a restrictive CSP to break.
app.use(helmet());

// Production is same-origin (the Vercel rewrite serves frontend + API from
// the same domain), so CORS only matters for local dev, where the Vite dev
// server (:5173) and this Express server (:4000) are different origins.
// `origin: true` used to reflect ANY origin back with credentials allowed —
// combined with cookie-based auth, that let any site a logged-in user
// visited read patient data via a cross-origin fetch(). Fixed via an
// explicit allowlist; extend ALLOWED_ORIGINS (comma-separated) in .env for
// edge cases like a Vercel preview URL, rather than reopening this.
const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  ...(process.env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean) ?? []),
];

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header (same-origin requests, curl, server-to-server) — allow.
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      const err = new Error("Not allowed by CORS");
      err.name = "CorsError";
      callback(err);
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

app.use(async (_req, _res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    next(err);
  }
});

app.use("/api", routes);

app.use(
  (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err.name === "ValidationError" || err.name === "CastError") {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err.name === "CorsError") {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }
    // Server-side only — never sent to the client (see ABSOLUTE DO NOT: no stack traces in error messages).
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  },
);

export default app;
