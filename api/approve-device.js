import { Redis } from "@upstash/redis";
const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  
  const { deviceId } = req.body;
  if (!deviceId) return res.status(400).json({ error: "deviceId required" });

  await redis.set(`verified:${deviceId}`, "1");
  return res.json({ success: true });
}
