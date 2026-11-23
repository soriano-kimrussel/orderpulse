import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { UserModel } from '../src/models/User.js';
import {
  PASSWORD,
  addMember,
  app,
  bearer,
  createOrder,
  registerAdmin,
  setStatus,
} from './support/helpers.js';

describe('registration and login', () => {
  it('registers an account and returns a JWT for its admin user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ accountName: 'Acme', email: 'Owner@Example.com', password: PASSWORD })
      .expect(201);

    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: 'owner@example.com', role: 'admin' });
    expect(res.body.user.accountId).toMatch(/^[0-9a-f]{24}$/);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('stores a hash, never the password', async () => {
    const admin = await registerAdmin();
    const user = await UserModel.findOne({ email: admin.email }).lean();

    expect(user?.passwordHash).toBeDefined();
    expect(user?.passwordHash).not.toBe(PASSWORD);
    expect(user?.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('rejects a duplicate email with 409', async () => {
    const admin = await registerAdmin();
    await request(app)
      .post('/api/auth/register')
      .send({ accountName: 'Copycat', email: admin.email, password: PASSWORD })
      .expect(409);
  });

  it('rejects invalid input with 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ accountName: 'Acme', email: 'not-an-email', password: 'short' })
      .expect(400);

    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(['email', 'password']),
    );
  });

  it('logs in with the right password and rejects the wrong one', async () => {
    const admin = await registerAdmin();

    const ok = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: PASSWORD })
      .expect(200);
    expect(ok.body.token).toEqual(expect.any(String));

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'wrong-password' })
      .expect(401);
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: PASSWORD })
      .expect(401);

    // Identical responses, so login cannot be used to probe for registered emails.
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  it('returns the current user from /me', async () => {
    const admin = await registerAdmin();
    const res = await request(app).get('/api/auth/me').set(bearer(admin.token)).expect(200);
    expect(res.body.user).toMatchObject({ email: admin.email, accountId: admin.accountId });
  });
});

describe('authentication', () => {
  it.each([
    ['GET', '/api/orders'],
    ['POST', '/api/orders'],
    ['GET', '/api/stats/revenue'],
    ['GET', '/api/stats/status'],
    ['GET', '/api/stats/top-products'],
    ['GET', '/api/users'],
    ['GET', '/api/auth/me'],
  ])('%s %s requires a token', async (method, path) => {
    const res = await (method === 'GET' ? request(app).get(path) : request(app).post(path));
    expect(res.status).toBe(401);
  });

  it('rejects a malformed or forged token', async () => {
    await request(app).get('/api/orders').set(bearer('not-a-jwt')).expect(401);

    // A structurally valid JWT signed with a different secret.
    const forged =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      'eyJzdWIiOiIxIiwiYWNjb3VudElkIjoiMSIsInJvbGUiOiJhZG1pbiJ9.' +
      'c2lnbmVkLXdpdGgtdGhlLXdyb25nLXNlY3JldA';
    await request(app).get('/api/orders').set(bearer(forged)).expect(401);
  });
});

describe('role enforcement', () => {
  it('lets a member create, view and advance orders', async () => {
    const admin = await registerAdmin();
    const member = await addMember(admin);

    const order = await createOrder(member);
    await request(app).get(`/api/orders/${order.orderId}`).set(bearer(member.token)).expect(200);
    await request(app).get('/api/orders').set(bearer(member.token)).expect(200);

    const paid = await setStatus(member, order.orderId, 'paid').expect(200);
    expect(paid.body.order.status).toBe('paid');
  });

  it('forbids a member from cancelling an order', async () => {
    const admin = await registerAdmin();
    const member = await addMember(admin);
    const order = await createOrder(member);

    await setStatus(member, order.orderId, 'cancelled').expect(403);

    const res = await request(app)
      .get(`/api/orders/${order.orderId}`)
      .set(bearer(member.token))
      .expect(200);
    expect(res.body.order.status).toBe('pending');
  });

  it('forbids a member from deleting an order', async () => {
    const admin = await registerAdmin();
    const member = await addMember(admin);
    const order = await createOrder(member);

    await request(app).delete(`/api/orders/${order.orderId}`).set(bearer(member.token)).expect(403);
    await request(app).get(`/api/orders/${order.orderId}`).set(bearer(member.token)).expect(200);
  });

  it('lets an admin cancel and delete orders', async () => {
    const admin = await registerAdmin();
    const toCancel = await createOrder(admin);
    const toDelete = await createOrder(admin);

    const cancelled = await setStatus(admin, toCancel.orderId, 'cancelled').expect(200);
    expect(cancelled.body.order.status).toBe('cancelled');

    await request(app).delete(`/api/orders/${toDelete.orderId}`).set(bearer(admin.token)).expect(204);
    await request(app).get(`/api/orders/${toDelete.orderId}`).set(bearer(admin.token)).expect(404);
  });

  it('forbids a member from managing users', async () => {
    const admin = await registerAdmin();
    const member = await addMember(admin);

    await request(app).get('/api/users').set(bearer(member.token)).expect(403);
    await request(app)
      .post('/api/users')
      .set(bearer(member.token))
      .send({ email: 'sneaky@example.com', password: PASSWORD, role: 'admin' })
      .expect(403);
  });
});
