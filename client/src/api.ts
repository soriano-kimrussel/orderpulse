import type {
  DailyRevenue,
  Order,
  OrderItem,
  OrderStatus,
  Session,
  Stats,
  StatusCounts,
  TopProduct,
} from './types';

/** Empty in development: requests go to the Vite dev server, which proxies them. */
export const API_URL: string = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) return undefined as T;

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `Request failed (${response.status})`;
    throw new ApiError(response.status, message);
  }
  return data as T;
}

export function login(email: string, password: string): Promise<Session> {
  return request<Session>('/api/auth/login', { method: 'POST', body: { email, password } });
}

export async function fetchRecentOrders(token: string, limit: number): Promise<Order[]> {
  const result = await request<{ data: Order[] }>(`/api/orders?limit=${limit}`, { token });
  return result.data;
}

export async function createOrder(
  token: string,
  input: { customerName: string; items: OrderItem[] },
): Promise<Order> {
  const result = await request<{ order: Order }>('/api/orders', {
    method: 'POST',
    token,
    body: input,
  });
  return result.order;
}

export async function updateOrderStatus(
  token: string,
  orderId: string,
  status: OrderStatus,
): Promise<Order> {
  const result = await request<{ order: Order }>(
    `/api/orders/${encodeURIComponent(orderId)}/status`,
    { method: 'PATCH', token, body: { status } },
  );
  return result.order;
}

export async function fetchStats(token: string): Promise<Stats> {
  const [revenue, status, topProducts] = await Promise.all([
    request<{ data: DailyRevenue[] }>('/api/stats/revenue', { token }),
    request<{ data: StatusCounts }>('/api/stats/status', { token }),
    request<{ data: TopProduct[] }>('/api/stats/top-products?limit=5', { token }),
  ]);
  return { revenue: revenue.data, status: status.data, topProducts: topProducts.data };
}
