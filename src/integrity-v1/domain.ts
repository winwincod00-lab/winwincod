/** Isolated proposal code. No Prisma client, I/O, runtime callers or financial writes. */
const SCALE = BigInt(10) ** BigInt(30);
const LIMIT = BigInt(10) ** BigInt(65);
export function money(value: string): bigint {
  if (typeof value !== 'string' || !/^-?\d{1,35}(?:\.\d{1,30})?$/.test(value)) throw new Error('Money must be an exact decimal string within numeric(65,30)');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(30, '0'));
  return negative ? -result : result;
}
export function decimal(value: bigint): string {
  if (value <= -LIMIT || value >= LIMIT) throw new Error('Money overflow');
  const absolute = value < BigInt(0) ? -value : value;
  const fractional = (absolute % SCALE).toString().padStart(30, '0').replace(/0+$/, '');
  return `${value < BigInt(0) ? '-' : ''}${absolute / SCALE}${fractional ? '.' + fractional : ''}`;
}
export function units(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new Error('Positive PostgreSQL Int quantity required');
  return value;
}
function positive(value: string): bigint { const parsed = money(value); if (parsed <= BigInt(0)) throw new Error('Positive money required'); return parsed; }

export type CostSnapshot = Readonly<{ sellerUnitCost: string | null; supplierUnitCost: string | null; source: 'UNKNOWN' | 'AT_CREATION' | 'AT_SUBMISSION' | 'EVIDENCE_REVIEW'; evidence: string | null }>;
export function snapshot(input: CostSnapshot): CostSnapshot {
  for (const value of [input.sellerUnitCost, input.supplierUnitCost]) if (value !== null && money(value) < BigInt(0)) throw new Error('Negative cost');
  if (input.source === 'UNKNOWN' && (input.sellerUnitCost !== null || input.supplierUnitCost !== null)) throw new Error('Unknown history must stay unknown');
  if ((input.source === 'AT_CREATION' || input.source === 'AT_SUBMISSION') && (input.sellerUnitCost === null || input.supplierUnitCost === null)) throw new Error('New cost capture requires both authoritative prices');
  if (input.source === 'EVIDENCE_REVIEW' && (!input.evidence?.trim() || (input.sellerUnitCost === null && input.supplierUnitCost === null))) throw new Error('Reviewed evidence required');
  return Object.freeze({ ...input });
}
// Caller supplies independently verified net recognized units; no automatic refund,
// fee allocation, clamping or assumption that carrier delivery means settled cash.
export function margin(cost: CostSnapshot, quantity: number, proceeds: string, fee: string, basis: 'PROJECTED' | 'DELIVERY_RECORDED' | 'SETTLEMENT_VERIFIED') {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 2147483647) throw new Error('Invalid recognized quantity');
  if (money(proceeds) < BigInt(0) || money(fee) < BigInt(0)) throw new Error('Negative proceeds/fee');
  const calculate = (unit: string | null) => unit === null ? null : decimal(money(proceeds) - money(unit) * BigInt(quantity) - money(fee));
  return Object.freeze({ basis, sellerMargin: calculate(cost.sellerUnitCost), supplierMargin: calculate(cost.supplierUnitCost) });
}
export function recognitionUnits(ordered: number, recognized: number, change: number): number {
  units(ordered);
  if (!Number.isInteger(recognized) || recognized < 0 || recognized > ordered || !Number.isInteger(change) || change === 0) throw new Error('Invalid recognition');
  const next = recognized + change;
  if (next < 0 || next > ordered) throw new Error('Recognition/reversal exceeds original quantity');
  return next;
}

export type WalletState = Readonly<{ balance: string; held: string }>;
export type WalletAction = 'CREDIT' | 'DEBIT' | 'HOLD' | 'RELEASE' | 'CONSUME';
export function walletTransition(state: WalletState, action: WalletAction, amount: string, holdRemaining?: string) {
  const balance = money(state.balance), held = money(state.held), quantity = positive(amount);
  if (held < BigInt(0) || balance < held) throw new Error('Corrupt wallet projection');
  const remaining = holdRemaining === undefined ? null : money(holdRemaining);
  if ((action === 'RELEASE' || action === 'CONSUME') && remaining !== quantity) throw new Error('Whole active hold required; partial payout policy is not approved');
  const cashDelta = action === 'CREDIT' ? quantity : action === 'DEBIT' || action === 'CONSUME' ? -quantity : BigInt(0);
  const heldDelta = action === 'HOLD' ? quantity : action === 'RELEASE' || action === 'CONSUME' ? -quantity : BigInt(0);
  const nextBalance = balance + cashDelta, nextHeld = held + heldDelta;
  if (nextHeld < BigInt(0) || nextBalance < nextHeld) throw new Error('Insufficient available balance');
  return Object.freeze({ balance: decimal(nextBalance), held: decimal(nextHeld), available: decimal(nextBalance - nextHeld), cashDelta: decimal(cashDelta), heldDelta: decimal(heldDelta) });
}

export const stockBuckets = ['AVAILABLE', 'RESERVED', 'IN_TRANSIT', 'RETURNED_PENDING_INSPECTION', 'DAMAGED'] as const;
export type StockBucket = typeof stockBuckets[number];
export type StockState = Readonly<Record<StockBucket, number>>;
export type StockAction = 'RESERVE' | 'RELEASE' | 'DISPATCH' | 'DELIVER' | 'RECEIVE_RETURN' | 'RESTOCK' | 'DISPOSE_DAMAGED';
const paths: Record<StockAction, readonly [StockBucket, StockBucket | null]> = {
  RESERVE: ['AVAILABLE', 'RESERVED'], RELEASE: ['RESERVED', 'AVAILABLE'], DISPATCH: ['RESERVED', 'IN_TRANSIT'],
  DELIVER: ['IN_TRANSIT', null], RECEIVE_RETURN: ['IN_TRANSIT', 'RETURNED_PENDING_INSPECTION'],
  RESTOCK: ['RETURNED_PENDING_INSPECTION', 'AVAILABLE'], DISPOSE_DAMAGED: ['RETURNED_PENDING_INSPECTION', 'DAMAGED'],
};
export function stockTransition(state: StockState, action: StockAction, quantity: number, inspected?: { disposition: 'SELLABLE' | 'DAMAGED'; remaining: number }) {
  units(quantity);
  for (const bucket of stockBuckets) if (!Number.isSafeInteger(state[bucket]) || state[bucket] < 0 || state[bucket] > 2147483647) throw new Error('Corrupt stock projection');
  if (action === 'RESTOCK' || action === 'DISPOSE_DAMAGED') {
    if (!inspected || inspected.disposition !== (action === 'RESTOCK' ? 'SELLABLE' : 'DAMAGED') || !Number.isInteger(inspected.remaining) || inspected.remaining < quantity) throw new Error('Inspected, unused disposition required');
  }
  const [from, to] = paths[action];
  if (state[from] < quantity) throw new Error('Insufficient source stock');
  const next = { ...state, [from]: state[from] - quantity };
  if (to) { next[to] += quantity; if (next[to] > 2147483647) throw new Error('Stock overflow'); }
  return Object.freeze(next);
}

export type ExpectedSettlement = { shipmentId: string; sellerId: string; carrierAccountId: string; externalRef: string | null; expectedCod: string | null; currency: string };
export type ObservedSettlement = { rowId: string; carrierAccountId: string; externalRef: string | null; gross: string; fee: string; adjustment: string; net: string; currency: string };
// One-to-one matching only. Repeated refs can mean duplicates OR partial statements;
// they always need review, never an automatic financial operation.
export function reconcile(expected: ExpectedSettlement[], observed: ObservedSettlement[]) {
  const output: { key: string; status: 'MATCH' | 'MISSING' | 'UNMATCHED' | 'AMBIGUOUS' | 'MISMATCH' | 'UNKNOWN_EXPECTATION' }[] = [];
  const rowCounts = new Map<string, number>();
  const scoped = (row: { carrierAccountId: string; externalRef: string | null }) => JSON.stringify([row.carrierAccountId, row.externalRef]);
  const rowKey = (row: ObservedSettlement) => JSON.stringify([row.carrierAccountId, row.rowId]);
  for (const row of observed) rowCounts.set(rowKey(row), (rowCounts.get(rowKey(row)) ?? 0) + 1);
  const refs = new Set([...expected.map(scoped), ...observed.map(scoped)]);
  for (const key of refs) {
    const local = expected.filter(row => scoped(row) === key), remote = observed.filter(row => scoped(row) === key);
    const [account, ref] = JSON.parse(key) as [string, string | null];
    if (!account || !ref || local.length > 1 || remote.length > 1 || remote.some(row => rowCounts.get(rowKey(row))! > 1)) { output.push({ key, status: 'AMBIGUOUS' }); continue; }
    if (!local.length) { output.push({ key, status: 'UNMATCHED' }); continue; }
    if (!remote.length) { output.push({ key, status: 'MISSING' }); continue; }
    const a = local[0], b = remote[0];
    const gross = money(b.gross), fee = money(b.fee), net = money(b.net), adjustment = money(b.adjustment);
    if (a.currency !== 'MAD' || b.currency !== 'MAD' || gross < BigInt(0) || fee < BigInt(0) || gross - fee + adjustment !== net) { output.push({ key, status: 'MISMATCH' }); continue; }
    if (a.expectedCod === null) { output.push({ key, status: 'UNKNOWN_EXPECTATION' }); continue; }
    output.push({ key, status: money(a.expectedCod) === gross ? 'MATCH' : 'MISMATCH' });
  }
  return output; // MATCH is arithmetic correspondence, not bank remittance or wallet-credit authorization.
}
