import { Router, type Request } from 'express';
import { authenticate, getAuth, requireRole } from '../middleware/auth.js';
import {
  createOrder,
  deleteOrder,
  getOrder,
  listOrders,
  updateOrderStatus,
} from '../services/order.service.js';
import { forbidden } from '../utils/errors.js';
import {
  createOrderSchema,
  listOrdersQuerySchema,
  updateStatusSchema,
} from '../validation/schemas.js';

export const ordersRouter = Router();

ordersRouter.use(authenticate);

const orderIdParam = (req: Request): string => String(req.params.orderId);

ordersRouter.post('/', async (req, res) => {
  const order = await createOrder(getAuth(req).accountId, createOrderSchema.parse(req.body));
  res.status(201).json({ order });
});

/** GET /api/orders?page=1&limit=20&status=paid */
ordersRouter.get('/', async (req, res) => {
  const query = listOrdersQuerySchema.parse(req.query);
  res.json(await listOrders(getAuth(req).accountId, query));
});

ordersRouter.get('/:orderId', async (req, res) => {
  res.json({ order: await getOrder(getAuth(req).accountId, orderIdParam(req)) });
});

/** Members may advance an order (paid, shipped). Only admins may cancel one. */
ordersRouter.patch('/:orderId/status', async (req, res) => {
  const auth = getAuth(req);
  const { status } = updateStatusSchema.parse(req.body);

  if (status === 'cancelled' && auth.role !== 'admin') {
    throw forbidden('Only admins can cancel orders');
  }

  res.json({ order: await updateOrderStatus(auth.accountId, orderIdParam(req), status) });
});

ordersRouter.delete('/:orderId', requireRole('admin'), async (req, res) => {
  await deleteOrder(getAuth(req).accountId, orderIdParam(req));
  res.status(204).end();
});
