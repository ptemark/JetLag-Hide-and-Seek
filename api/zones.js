import { getZones } from '../functions/zones.js';

export default async function handler(req, res) {
  try {
    const query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
    const result = await getZones({ method: req.method, query });
    res.status(result.status).json(result.body);
  } catch (_err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
