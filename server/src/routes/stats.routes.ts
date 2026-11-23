import { Router } from 'express';
import { authenticate, getAuth } from '../middleware/auth.js';
import { getRevenueByDay, getStatusCounts, getTopProducts } from '../services/stats.service.js';
import { topProductsQuerySchema } from '../validation/schemas.js';

export const statsRouter = Router();

statsRouter.use(authenticate);

/** Revenue per UTC day for the last 14 days. */
statsRouter.get('/revenue', async (req, res) => {
  res.json({ data: await getRevenueByDay(getAuth(req).accountId) });
});

/** Order counts by status. */
statsRouter.get('/status', async (req, res) => {
  res.json({ data: await getStatusCounts(getAuth(req).accountId) });
});

/** GET /api/stats/top-products?limit=5 */
statsRouter.get('/top-products', async (req, res) => {
  const { limit } = topProductsQuerySchema.parse(req.query);
  res.json({ data: await getTopProducts(getAuth(req).accountId, limit) });
});
