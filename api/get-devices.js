import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  try {
    const keys = await redis.keys("verified:*");

    // Format: remove prefix
    const devices = keys.map(k => k.replace("verified:", ""));

    return res.status(200).json({ devices });
  } catch (err) {
    return res.status(500).json({ error: "Failed fetching devices" });
  }
}
