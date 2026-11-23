import type { OrderItem } from './types';

const CUSTOMERS = [
  'Ada Lovelace',
  'Grace Hopper',
  'Alan Turing',
  'Katherine Johnson',
  'Linus Torvalds',
  'Margaret Hamilton',
  'Dennis Ritchie',
  'Barbara Liskov',
];

const PRODUCTS: { name: string; price: number }[] = [
  { name: 'Mechanical Keyboard', price: 12_900 },
  { name: 'Wireless Mouse', price: 4_900 },
  { name: '27" Monitor', price: 32_900 },
  { name: 'USB-C Dock', price: 8_900 },
  { name: 'Laptop Stand', price: 3_900 },
  { name: 'Webcam', price: 6_900 },
];

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)] as T;
}

/** A random but plausible order for the "Simulate order" button. */
export function randomOrder(): { customerName: string; items: OrderItem[] } {
  const lineCount = 1 + Math.floor(Math.random() * 3);
  const chosen = new Map<string, OrderItem>();
  while (chosen.size < lineCount) {
    const product = pick(PRODUCTS);
    chosen.set(product.name, { ...product, qty: 1 + Math.floor(Math.random() * 3) });
  }
  return { customerName: pick(CUSTOMERS), items: [...chosen.values()] };
}
