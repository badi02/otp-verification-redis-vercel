import nodemailer from "nodemailer";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Config
const OTP_TTL_SECONDS = 5 * 60; // 5 minutes
const SEND_LIMIT_PER_HOUR = 5;
const SEND_LIMIT_KEY_PREFIX = "sendcount:";
const OTP_KEY_PREFIX = "otp:";
const VERIFIED_KEY_PREFIX = "verified:";
const LOCK_KEY_PREFIX = "lock:";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );
}

export default async function handler(req, res) {
  // Add CORS headers
  setCors(res);
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { deviceId } = body || {};

    if (!deviceId) {
      return res.status(400).json({ error: "deviceId is required" });
    }

    // If already verified for this device, short-circuit
    const verifiedKey = `${VERIFIED_KEY_PREFIX}${deviceId}`;
    const verifiedRaw = await redis.get(verifiedKey);
    if (verifiedRaw) {
      // verifiedRaw may be JSON or plain value; try parse
      let verifiedData;
      try {
        verifiedData = typeof verifiedRaw === "string" ? JSON.parse(verifiedRaw) : verifiedRaw;
      } catch (e) {
        verifiedData = verifiedRaw;
      }

      // If the stored record indicates the same deviceId as key, return verified
      // (we keyed verified by hashed deviceId, so this is already device-scoped)
      return res.status(200).json({ message: "Device already verified", verified: true });
    }

    /* const already = await redis.get(verifiedKey);
    if (already) {
      return res.status(200).json({ message: "Device already verified" });
    } */

    // Rate limit sends per device (hourly)
    const sendCountKey = `${SEND_LIMIT_KEY_PREFIX}${deviceId}`;
    const sends = await redis.incr(sendCountKey);
    if (sends === 1) {
      // set expiry 1 hour on first increment
      await redis.expire(sendCountKey, 60 * 60);
    }
    if (sends > SEND_LIMIT_PER_HOUR) {
      return res.status(429).json({ error: "Send limit exceeded. Try later." });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const otpKey = `${OTP_KEY_PREFIX}${deviceId}`;
    // Store OTP + attempts = 0
    await redis.set(otpKey, JSON.stringify({ otp, attempts: 0 }), { ex: OTP_TTL_SECONDS });

    // Send email only if email credentials are configured
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS, // app password
        },
      });

      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: process.env.EMAIL_USER,
        subject: `New OTP for device ${deviceId}`,
        text: `<p>Your OTP is: <b>${otp}</b>\n\nThis code will expire in 5 minutes.</p>`,
      };

      await transporter.sendMail(mailOptions);
    } else {
      // For development
      if (process.env.NODE_ENV !== "production") {
        console.log(`OTP for ${deviceId}: ${otp}`);
      }
    }

    return res.status(200).json({ message: "OTP sent" });
  } catch (err) {
    console.error("send-otp error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}