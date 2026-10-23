/** PROPOSAL ONLY. No runtime adapter exists; every write below is an injected port.
 * Methods must map to ONE PostgreSQL SERIALIZABLE transaction, never independent transactions.
 */
import { assertBatchIds, assertBatchUnits } from '../lib/order-policy';
import { decimal, money, units, walletTransition, type CostSnapshot, type WalletState } from './domain';

type Identity = Readonly<{ sellerId: string; kind: string; requestKey: string; businessKey: string; payloadHash: string; policyApprovalRef: string }>;
export type BatchLine = Readonly<{ id: string; sellerId: string; productId: string; quantity: number; status: string; snapshotId: string; cost: CostSnapshot }>;
export type Batch = Readonly<{ id: string; sellerId: string; paid: boolean; review: 'PENDING' | 'APPROVED' | 'REJECTED'; total: string; lines: readonly BatchLine[] }>;
export type Receipt = Readonly<{ batchId: string; walletEventId: string; reservationIds: readonly string[] }>;
export interface PaymentTransaction {
  assertCurrentSeller(actorId: string, sellerId: string): Promise<void>;
  requireOwnerPolicy(approvalRef: string): Promise<void>;
  claimOperation(identity: Identity): Promise<{ operationId: string; replay: Receipt | null }>;
  readBatchForLockPlan(batchId: string, sellerId: string): Promise<Batch>;
  lockWallet(sellerId: string): Promise<WalletState>;
  lockStockProducts(sortedProductIds: readonly string[]): Promise<void>;
  lockBatchAndLines(batchId: string, sellerId: string): Promise<Batch>;
  claimUnpaidBatchAndProcessingOrders(batchId: string, sellerId: string, lineIds: readonly string[]): Promise<void>;
  appendImmutableLineCharges(batch: Batch, operationId: string): Promise<void>;
  reserveLine(line: BatchLine, operationId: string): Promise<string>;
  debitAndPostBalancedJournal(operationId: string, sellerId: string, exactAmount: string): Promise<string>;
  appendHistoryAndAudit(batch: Batch, operationId: string, actorId: string): Promise<void>;
  completeOperation(operationId: string, result: Receipt): Promise<void>;
}
export interface PaymentDatabase { serializable<T>(work: (tx: PaymentTransaction) => Promise<T>): Promise<T> }

export async function proposedPayBatch(db: PaymentDatabase, input: { actorId: string; sellerId: string; batchId: string; requestKey: string; payloadHash: string; policyApprovalRef: string }): Promise<Receipt> {
  if (!input.requestKey.trim() || !/^[a-f0-9]{64}$/.test(input.payloadHash) || !input.policyApprovalRef.trim()) throw new Error('Operation identity and approved pricing policy required');
  return db.serializable(async tx => {
    await tx.assertCurrentSeller(input.actorId, input.sellerId);
    await tx.requireOwnerPolicy(input.policyApprovalRef); // Explicit owner decision: captured quote vs submission-time charge.
    const claim = await tx.claimOperation({ sellerId: input.sellerId, kind: 'BATCH_PAYMENT', requestKey: input.requestKey, businessKey: input.batchId, payloadHash: input.payloadHash, policyApprovalRef: input.policyApprovalRef });
    if (claim.replay) { if (claim.replay.batchId !== input.batchId) throw new Error('Receipt mismatch'); return claim.replay; }
    const planned = await tx.readBatchForLockPlan(input.batchId, input.sellerId);
    const wallet = await tx.lockWallet(input.sellerId);
    const productIds = [...new Set(planned.lines.map(line => line.productId))].sort();
    await tx.lockStockProducts(productIds);
    const batch = await tx.lockBatchAndLines(input.batchId, input.sellerId);
    if (batch.id !== input.batchId || batch.sellerId !== input.sellerId || batch.paid || batch.review !== 'APPROVED') throw new Error('Unpaid, explicitly approved seller batch required');
    if (JSON.stringify([...batch.lines.map(line => line.id)].sort()) !== JSON.stringify([...planned.lines.map(line => line.id)].sort()) ||
        JSON.stringify([...new Set(batch.lines.map(line => line.productId))].sort()) !== JSON.stringify(productIds)) throw new Error('Lock plan changed; abort and refresh');
    assertBatchIds(batch.lines.map(line => line.id)); assertBatchUnits([...batch.lines]);
    let total = BigInt(0);
    for (const line of batch.lines) {
      units(line.quantity);
      if (line.sellerId !== input.sellerId || line.status !== 'WAITING_PAYMENT' || !line.snapshotId || line.cost.sellerUnitCost === null) throw new Error('Ineligible line or unknown historical charge');
      const cost = money(line.cost.sellerUnitCost);
      if (cost < BigInt(0)) throw new Error('Invalid captured charge');
      total += cost * BigInt(line.quantity) + money('20'); // 20 MAD per customer order; not per PCS.
    }
    const exactAmount = decimal(total);
    if (money(batch.total) !== total) throw new Error('Reviewed quote differs from captured costs: explicit policy resolution required');
    walletTransition(wallet, 'DEBIT', exactAmount); // Includes every active withdrawal hold.
    await tx.claimUnpaidBatchAndProcessingOrders(batch.id, input.sellerId, batch.lines.map(line => line.id));
    await tx.appendImmutableLineCharges(batch, claim.operationId);
    const reservations: string[] = [];
    for (const line of [...batch.lines].sort((a, b) => a.productId.localeCompare(b.productId) || a.id.localeCompare(b.id))) reservations.push(await tx.reserveLine(line, claim.operationId));
    const walletEventId = await tx.debitAndPostBalancedJournal(claim.operationId, input.sellerId, exactAmount);
    await tx.appendHistoryAndAudit(batch, claim.operationId, input.actorId);
    const result = Object.freeze({ batchId: batch.id, walletEventId, reservationIds: Object.freeze(reservations) });
    await tx.completeOperation(claim.operationId, result);
    return result;
  });
}
