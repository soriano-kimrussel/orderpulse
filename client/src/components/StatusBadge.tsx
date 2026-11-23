import type { OrderStatus } from '../types';

const LABELS: Record<OrderStatus, string> = {
  pending: 'Pending',
  paid: 'Paid',
  shipped: 'Shipped',
  cancelled: 'Cancelled',
};

/** A status is always shown as a dot plus its name, never colour alone. */
export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`badge badge-${status}`}>
      <span className="badge-dot" aria-hidden="true" />
      {LABELS[status]}
    </span>
  );
}
