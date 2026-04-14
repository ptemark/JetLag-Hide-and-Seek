import { setup, teardown } from './setup.js';
import { registerPlayer }  from '../functions/players.js';

describe.skipIf(!process.env.DATABASE_URL)('registerPlayer', () => {
  let pool;
  beforeAll(async () => { pool = await setup(); });
  afterAll(async ()  => { await teardown(pool); });

  it('registers a hider and returns 201 with expected fields', async () => {
    const res = await registerPlayer({ method: 'POST', body: { name: 'Alice', role: 'hider' } }, pool);
    expect(res.status).toBe(201);
    expect(res.body.playerId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.name).toBe('Alice');
    expect(res.body.role).toBe('hider');
    expect(res.body.createdAt).toBeTruthy();
  });

  it('registers a seeker and returns 201', async () => {
    const res = await registerPlayer({ method: 'POST', body: { name: 'Bob', role: 'seeker' } }, pool);
    expect(res.status).toBe(201);
    expect(res.body.role).toBe('seeker');
  });

  it('rejects missing name with 400', async () => {
    const res = await registerPlayer({ method: 'POST', body: { role: 'hider' } }, pool);
    expect(res.status).toBe(400);
  });

  it('rejects empty string name with 400', async () => {
    const res = await registerPlayer({ method: 'POST', body: { name: '', role: 'hider' } }, pool);
    expect(res.status).toBe(400);
  });

  it('rejects missing role with 400', async () => {
    const res = await registerPlayer({ method: 'POST', body: { name: 'Charlie' } }, pool);
    expect(res.status).toBe(400);
  });

  it('rejects invalid role with 400', async () => {
    const res = await registerPlayer({ method: 'POST', body: { name: 'Dave', role: 'admin' } }, pool);
    expect(res.status).toBe(400);
  });

  it('two sequential registrations produce distinct playerIds', async () => {
    const a = await registerPlayer({ method: 'POST', body: { name: 'Eve', role: 'hider' } }, pool);
    const b = await registerPlayer({ method: 'POST', body: { name: 'Frank', role: 'seeker' } }, pool);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.playerId).not.toBe(b.body.playerId);
  });
});
