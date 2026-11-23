import { useCallback, useEffect, useState } from 'react';
import { ApiError, createOrder, fetchStats, updateOrderStatus } from '../api';
import { useAuth } from '../auth';
import { OrdersTable } from '../components/OrdersTable';
import { StatsPanel } from '../components/StatsPanel';
import { useLiveOrders } from '../hooks/useLiveOrders';
import { randomOrder } from '../sampleOrder';
import type { OrderStatus, Session, Stats } from '../types';

export function DashboardPage({ session }: { session: Session }) {
  const { logout } = useAuth();
  const { token, user } = session;

  const live = useLiveOrders(token, logout);
  const [stats, setStats] = useState<Stats | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);

  // Stats are computed by the database, so they are re-fetched (not patched
  // locally) whenever a live event arrives. The short delay collapses a burst
  // of events into one request.
  useEffect(() => {
    let active = true;
    const timer = setTimeout(
      () => {
        fetchStats(token)
          .then((next) => {
            if (active) setStats(next);
          })
          .catch((cause: unknown) => {
            if (cause instanceof ApiError && cause.status === 401) logout();
          });
      },
      live.eventCount === 0 ? 0 : 250,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [token, live.eventCount, logout]);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        setActionError(null);
        await action();
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 401) logout();
        else setActionError(cause instanceof Error ? cause.message : 'Something went wrong');
      }
    },
    [logout],
  );

  // Neither handler touches local state on success: the server's Socket.IO
  // event is what updates the list, exactly as it would for any other user.
  const simulateOrder = async (): Promise<void> => {
    setSimulating(true);
    await run(() => createOrder(token, randomOrder()));
    setSimulating(false);
  };

  const setStatus = (orderId: string, status: OrderStatus): void => {
    void run(() => updateOrderStatus(token, orderId, status));
  };

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          OrderPulse
        </div>
        <div className="topbar-right">
          <span className={`live ${live.connected ? 'is-on' : 'is-off'}`} role="status">
            <span className="live-dot" aria-hidden="true" />
            {live.connected ? 'Live' : 'Reconnecting…'}
          </span>
          <span className="muted user">
            {user.email} · {user.role}
          </span>
          <button type="button" className="button ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <main className="content">
        <StatsPanel stats={stats} />

        <section className="card">
          <header className="card-header">
            <div>
              <h2>Recent orders</h2>
              <span className="muted">Updates live over Socket.IO, no refresh needed</span>
            </div>
            <button
              type="button"
              className="button primary"
              onClick={() => void simulateOrder()}
              disabled={simulating}
            >
              Simulate order
            </button>
          </header>

          {(actionError ?? live.error) && (
            <p className="error" role="alert">
              {actionError ?? live.error}
            </p>
          )}

          <OrdersTable
            orders={live.orders}
            role={user.role}
            changedAt={live.changedAt}
            onSetStatus={setStatus}
          />
        </section>
      </main>
    </div>
  );
}
