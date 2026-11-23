const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const compactMoney = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const time = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Amounts travel as integer cents; only the display divides by 100. */
export const formatMoney = (cents: number): string => money.format(cents / 100);
export const formatMoneyCompact = (cents: number): string => compactMoney.format(cents / 100);
export const formatTime = (iso: string): string => time.format(new Date(iso));
/** Formats a YYYY-MM-DD UTC day as e.g. "Nov 24". */
export const formatDay = (isoDay: string): string => day.format(new Date(`${isoDay}T00:00:00Z`));
