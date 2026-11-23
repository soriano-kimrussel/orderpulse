import { formatMoney, formatTime } from '../format';
import type { Order, OrderStatus, UserRole } from '../types';
import { StatusBadge } from './StatusBadge';

/** The next step in an order's life, if it has one. */
const NEXT_STATUS: Partial<Record<OrderStatus, { status: OrderStatus; label: string }>> = {
  pending: { status: 'paid', label: 'Mark paid' },
  paid: { status: 'shipped', label: 'Mark shipped' },
};

const CANCELLABLE: OrderStatus[] = ['pending', 'paid'];

interface Props {
  orders: Order[];
  role: UserRole;
  changedAt: Record<string, number>;
  onSetStatus(orderId: string, status: OrderStatus): void;
}

export function OrdersTable({ orders, role, changedAt, onSetStatus }: Props) {
  if (orders.length === 0) {
    return <p className="muted empty">No orders yet. Click “Simulate order” to create one.</p>;
  }

  return (
    <div className="table-scroll">
      <table className="orders">
        <thead>
          <tr>
            <th scope="col">Order</th>
            <th scope="col">Customer</th>
            <th scope="col">Items</th>
            <th scope="col" className="numeric">
              Amount
            </th>
            <th scope="col">Status</th>
            <th scope="col">Created</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const next = NEXT_STATUS[order.status];
            const stamp = changedAt[order.orderId];
            return (
              // The key changes when a live event touches the row, which
              // remounts it and replays the highlight animation.
              <tr key={`${order.orderId}:${stamp ?? 0}`} className={stamp ? 'flash' : undefined}>
                <td className="mono">{order.orderId}</td>
                <td>{order.customerName}</td>
                <td className="muted">
                  {order.items.map((item) => `${item.qty}× ${item.name}`).join(', ')}
                </td>
                <td className="numeric">{formatMoney(order.amount)}</td>
                <td>
                  <StatusBadge status={order.status} />
                </td>
                <td className="muted nowrap">{formatTime(order.createdAt)}</td>
                <td className="actions">
                  {next && (
                    <button
                      type="button"
                      className="button small"
                      onClick={() => onSetStatus(order.orderId, next.status)}
                    >
                      {next.label}
                    </button>
                  )}
                  {role === 'admin' && CANCELLABLE.includes(order.status) && (
                    <button
                      type="button"
                      className="button small ghost"
                      onClick={() => onSetStatus(order.orderId, 'cancelled')}
                    >
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
