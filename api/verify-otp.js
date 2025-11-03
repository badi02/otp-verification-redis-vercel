// api/verify-otp.js
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const OTP_KEY_PREFIX = "otp:";
const LOCK_KEY_PREFIX = "lock:";
const VERIFIED_KEY_PREFIX = "verified:";
const MAX_ATTEMPTS = 3;
const LOCK_TTL_SECONDS = 60 * 60; // 1 hour
const VERIFIED_TTL_SECONDS = 365 * 24 * 60 * 60; // 1 year

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { deviceId, otp } = body || {};

    if (!deviceId || !otp) {
      return res.status(400).json({ error: "deviceId and otp are required" });
    }

    // Check lock
    const lockKey = `${LOCK_KEY_PREFIX}${deviceId}`;
    const isLocked = await redis.get(lockKey);
    if (isLocked) {
      return res.status(423).json({ error: "Device locked due to too many attempts. Try later." });
    }

    const otpKey = `${OTP_KEY_PREFIX}${deviceId}`;
    const otpRaw = await redis.get(otpKey);
    if (!otpRaw) {
      return res.status(410).json({ error: "No valid OTP found or OTP expired" });
    }

    let otpData;
    try {
      otpData = typeof otpRaw === "string" ? JSON.parse(otpRaw) : otpRaw;
    } catch (e) {
      otpData = otpRaw;
    }

    if (otpData.otp === otp) {
      // Success: set verified flag and delete OTP
      const verifiedKey = `${VERIFIED_KEY_PREFIX}${deviceId}`;
      await redis.set(verifiedKey, "1", { ex: VERIFIED_TTL_SECONDS });
      await redis.del(otpKey);
      return res.status(200).json({ success: true, message: "Verified" });
    } else {
      // Increment attempts
      otpData.attempts = (otpData.attempts || 0) + 1;
      // Update OTP with same TTL — keep existing expiry (re-set with a small remaining TTL isn't exact; to be simple, set fresh TTL)
      const ttl = await redis.ttl(otpKey); // get remaining TTL
      await redis.set(otpKey, JSON.stringify(otpData), { ex: ttl > 0 ? ttl : 1 });

      const attemptsLeft = MAX_ATTEMPTS - otpData.attempts;
      if (otpData.attempts >= MAX_ATTEMPTS) {
        // lock device
        await redis.set(`${LOCK_KEY_PREFIX}${deviceId}`, "1", { ex: LOCK_TTL_SECONDS });
        return res.status(423).json({ error: "Too many attempts. Device locked for 1 hour." });
      } else {
        return res.status(400).json({ success: false, attemptsLeft, error: "Invalid OTP" });
      }
    }
  } catch (err) {
    console.error("verify-otp error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
