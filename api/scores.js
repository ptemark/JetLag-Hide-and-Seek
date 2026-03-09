import { submitScore } from '../functions/scores.js';

export default async function handler(req, res) {
  const result = await submitScore({ method: req.method, body: req.body });
  res.status(result.status).json(result.body);
}
