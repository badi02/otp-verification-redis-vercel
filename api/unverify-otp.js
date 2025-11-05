import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { deviceId } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: "deviceId is required" });
    }

    // Redis keys you created earlier
    const verifiedKey = `device:${deviceId}:verified`;
    const otpKey = `otp:${deviceId}`;
    const attemptsKey = `attempts:${deviceId}`;

    // Remove device verification + OTP + attempts
    await redis.del(verifiedKey);
    await redis.del(otpKey);
    await redis.del(attemptsKey);

    return res.status(200).json({ success: true, message: "Device unverified successfully" });
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}
