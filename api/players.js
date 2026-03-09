import { registerPlayer } from '../functions/players.js';

export default async function handler(req, res) {
  const result = await registerPlayer({ method: req.method, body: req.body });
  res.status(result.status).json(result.body);
}
