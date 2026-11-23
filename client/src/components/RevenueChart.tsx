import { useState } from 'react';
import { formatDay, formatMoney, formatMoneyCompact } from '../format';
import type { DailyRevenue } from '../types';

/**
 * Revenue per day as a single-series bar chart.
 *
 * One series, so one colour and no legend: the card title names it. Hovering
 * or focusing a day shows its exact figures, and a visually hidden table
 * carries the same data for screen readers.
 */
export function RevenueChart({ days }: { days: DailyRevenue[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...days.map((day) => day.revenue), 1);
  const lastIndex = days.length - 1;

  return (
    <div className="chart">
      <div className="chart-scale" aria-hidden="true">
        <span>{formatMoneyCompact(max)}</span>
        <span>$0</span>
      </div>

      <div className="chart-body">
        <div className="chart-plot" aria-hidden="true" onMouseLeave={() => setActive(null)}>
          {days.map((day, index) => (
            <div
              key={day.date}
              className={`chart-column${active === index ? ' is-active' : ''}`}
              onMouseEnter={() => setActive(index)}
            >
              <div
                className="chart-bar"
                style={{ height: `${(day.revenue / max) * 100}%` }}
              />
              {active === index && (
                <div
                  className={`chart-tooltip${index < 2 ? ' align-start' : ''}${
                    index > lastIndex - 2 ? ' align-end' : ''
                  }`}
                >
                  <strong>{formatMoney(day.revenue)}</strong>
                  <span>
                    {formatDay(day.date)} · {day.orders} {day.orders === 1 ? 'order' : 'orders'}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="chart-axis" aria-hidden="true">
          <span>{days[0] ? formatDay(days[0].date) : ''}</span>
          <span>{days[lastIndex] ? `${formatDay(days[lastIndex].date)} (today)` : ''}</span>
        </div>
      </div>

      <table className="sr-only">
        <caption>Revenue per day, last 14 days (UTC)</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Revenue</th>
            <th scope="col">Orders</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <th scope="row">{formatDay(day.date)}</th>
              <td>{formatMoney(day.revenue)}</td>
              <td>{day.orders}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
