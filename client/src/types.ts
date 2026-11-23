// Mirrors the server's DTOs (server/src/services/*.service.ts).

export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'cancelled';
export type UserRole = 'admin' | 'member';

export interface OrderItem {
  name: string;
  qty: number;
  /** Cents. */
  price: number;
}

export interface Order {
  id: string;
  orderId: string;
  customerName: string;
  items: OrderItem[];
  /** Cents. */
  amount: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  accountId: string;
  email: string;
  role: UserRole;
}

export interface Session {
  token: string;
  user: User;
}

export interface DailyRevenue {
  date: string;
  revenue: number;
  orders: number;
}

export type StatusCounts = Record<OrderStatus, number>;

export interface TopProduct {
  name: string;
  revenue: number;
  unitsSold: number;
  orders: number;
}

export interface Stats {
  revenue: DailyRevenue[];
  status: StatusCounts;
  topProducts: TopProduct[];
}

/** Events pushed by the server over Socket.IO. */
export interface ServerToClientEvents {
  'order:created': (order: Order) => void;
  'order:updated': (order: Order) => void;
  'order:deleted': (payload: { orderId: string }) => void;
}
