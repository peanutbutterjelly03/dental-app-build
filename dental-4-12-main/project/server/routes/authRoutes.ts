import { Router } from "express";
import rateLimit from "express-rate-limit";
import { login, refresh, logout, me, changePassword, verifyOtp, forgotPassword, resetPassword, verifyPassword } from "../controllers/authController.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

// Login is the real brute-force target (password guessing). ~10 staff users
// at this app's scale — 10 attempts per 15 minutes per IP is generous for a
// legitimate typo-prone login, but shuts down automated guessing.
const makeAuthLimiter = () =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many attempts. Please try again later." },
  });

router.post("/login", makeAuthLimiter(), asyncHandler(login));
// Separate limiter instances per route: OTP guessing and reset flooding are
// the same brute-force class as password guessing, but a 2FA login spends
// requests on 2-3 of these routes — sharing one pool would starve an office
// of staff behind a single school IP.
router.post("/verify-otp", makeAuthLimiter(), asyncHandler(verifyOtp));
router.post("/forgot-password", makeAuthLimiter(), asyncHandler(forgotPassword));
router.post("/reset-password", makeAuthLimiter(), asyncHandler(resetPassword));
router.post("/refresh", asyncHandler(refresh));
router.post("/logout", logout);
router.get("/me", requireAuth, asyncHandler(me));
router.patch("/change-password", requireAuth, asyncHandler(changePassword));
// Step-up for bulk/structural actions. Rate-limited like every other
// password path — an unlimited yes/no on a password is an oracle.
router.post("/verify-password", makeAuthLimiter(), requireAuth, asyncHandler(verifyPassword));

export default router;
