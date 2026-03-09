import { initiateSession } from '../../functions/sessions.js';

export default async function handler(req, res) {
  const result = await initiateSession({ method: req.method, body: req.body });
  res.status(result.status).json(result.body);
}
