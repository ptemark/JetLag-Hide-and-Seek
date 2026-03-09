import { getLiveState } from '../../functions/liveState.js';

export default async function handler(req, res) {
  const result = await getLiveState(
    { method: req.method, params: { gameId: req.query.gameId } },
    { serverUrl: process.env.GAME_SERVER_URL },
  );
  res.status(result.status).json(result.body);
}
