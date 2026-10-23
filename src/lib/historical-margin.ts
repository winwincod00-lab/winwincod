import { Prisma } from '@prisma/client';

// Read-only calculation contract for reviewed snapshots. No persistence/backfill is implied.
// A current product price is deliberately not an input.
export function historicalMargin(input: {
  unitCost: string | null;
  quantity: number;
  proceeds: string;
  fee: string;
  realized: boolean;
}) {
  if (input.unitCost === null) return { kind: 'UNKNOWN_COST' as const, amount: null };
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) throw new Error('Invalid quantity');
  const cost = new Prisma.Decimal(input.unitCost);
  const proceeds = new Prisma.Decimal(input.proceeds);
  const fee = new Prisma.Decimal(input.fee);
  if ([cost, proceeds, fee].some(value => !value.isFinite() || value.lt(0))) throw new Error('Invalid money');
  // Raw margin, not the existing clamped delivery-wallet policy. Never writes wallet/netProfit.
  return { kind: input.realized ? 'REALIZED' as const : 'PROJECTED' as const, amount: proceeds.minus(cost.times(input.quantity)).minus(fee).toFixed() };
}
