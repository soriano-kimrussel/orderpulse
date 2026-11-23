import { formatMoney } from '../format';
import type { OrderStatus, Stats } from '../types';
import { RevenueChart } from './RevenueChart';
import { StatusBadge } from './StatusBadge';

const STATUSES: OrderStatus[] = ['pending', 'paid', 'shipped', 'cancelled'];

export function StatsPanel({ stats }: { stats: Stats | null }) {
  if (!stats) {
    return <section className="card muted">Loading stats…</section>;
  }

  const today = stats.revenue[stats.revenue.length - 1];
  const windowTotal = stats.revenue.reduce((sum, day) => sum + day.revenue, 0);

  return (
    <section className="stats" aria-label="Statistics">
      <div className="tiles">
        <div className="card tile">
          <span className="tile-label">Revenue today</span>
          <span className="tile-value">{formatMoney(today?.revenue ?? 0)}</span>
          <span className="tile-note">
            {today?.orders ?? 0} paid {today?.orders === 1 ? 'order' : 'orders'} · UTC day
          </span>
        </div>

        <div className="card tile">
          <span className="tile-label">Orders by status</span>
          <ul className="status-counts">
            {STATUSES.map((status) => (
              <li key={status}>
                <StatusBadge status={status} />
                <span className="status-count">{stats.status[status]}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="panels">
        <div className="card">
          <header className="card-header">
            <h2>Revenue, last 14 days</h2>
            <span className="muted">{formatMoney(windowTotal)} total</span>
          </header>
          <RevenueChart days={stats.revenue} />
        </div>

        <div className="card">
          <header className="card-header">
            <h2>Top products</h2>
            <span className="muted">by revenue</span>
          </header>
          {stats.topProducts.length === 0 ? (
            <p className="muted">No paid orders yet.</p>
          ) : (
            <ol className="products">
              {stats.topProducts.map((product) => (
                <li key={product.name}>
                  <span className="product-name">{product.name}</span>
                  <span className="muted">{product.unitsSold} sold</span>
                  <span className="product-revenue">{formatMoney(product.revenue)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
