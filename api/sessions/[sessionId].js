import { terminateSession } from '../../functions/sessions.js';

export default async function handler(req, res) {
  const result = await terminateSession({
    method: req.method,
    params: { sessionId: req.query.sessionId },
  });
  res.status(result.status).json(result.body);
}
