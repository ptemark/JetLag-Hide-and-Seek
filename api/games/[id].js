import { getGame } from '../../functions/games.js';

export default async function handler(req, res) {
  const result = await getGame({ method: req.method, params: { id: req.query.id } });
  res.status(result.status).json(result.body);
}
