import { getAdminStatus } from '../functions/admin.js';

export default async function handler(req, res) {
  const result = await getAdminStatus(
    { method: req.method, headers: req.headers },
    { serverUrl: process.env.GAME_SERVER_URL },
  );
  res.status(result.status).json(result.body);
}
