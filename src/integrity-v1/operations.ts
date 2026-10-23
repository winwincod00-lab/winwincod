/** ISOLATED IMPLEMENTATION DRAFT. No Prisma adapter or runtime callers.
 * All ports must share ONE SERIALIZABLE transaction. They must not call transport.
 * Schema, approved policies, evidence and real PostgreSQL tests block activation.
 */
import { createHash } from 'node:crypto';
import { decimal, money, reconcile, snapshot, stockTransition, units, walletTransition,
  type CostSnapshot, type ExpectedSettlement, type ObservedSettlement, type StockState, type WalletState } from './domain';

export type Envelope = Readonly<{ actorId: string; sellerId: string; requestKey: string; policyRef: string }>;
export type Identity = Envelope & Readonly<{ kind: string; businessKey: string; payloadHash: string }>;
export type Result = Readonly<{ operationId: string; effectId: string }>;
export interface OperationTransaction {
  // Recheck current activation, role, seller ownership OR explicit warehouse grant,
  // and unrevoked owner policy even on replay. Never trust an HTTP role parameter.
  authorize(identity: Identity): Promise<void>;
  // Unique request AND business identity, payload binding, no incomplete replay.
  claim(identity: Identity): Promise<{ operationId: string; replay: Result | null }>;
  // Replays must check persisted receipt/effect/tenant integrity, not recreate effects.
  verifyReplay(identity: Identity, result: Result): Promise<void>;
  audit(identity: Identity, result: Result): Promise<void>;
  complete(identity: Identity, result: Result): Promise<void>;
}
export interface Database<T extends OperationTransaction> {
  serializable<R>(work: (tx: T) => Promise<R>): Promise<R>;
}
function text(value: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw new Error('Required bounded identity/evidence');
  return value;
}
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function positive(value: string): string {
  if (money(value) <= BigInt(0)) throw new Error('Positive exact amount required');
  return decimal(money(value));
}
function identity(envelope: Envelope, kind: string, businessKey: string, payload: unknown): Identity {
  for (const value of [envelope.actorId, envelope.sellerId, envelope.requestKey, envelope.policyRef, businessKey]) text(value);
  return Object.freeze({ ...envelope, kind, businessKey, payloadHash: hash([envelope.sellerId, kind, businessKey, envelope.policyRef, payload]) });
}
async function run<T extends OperationTransaction>(db: Database<T>, id: Identity, effect: (tx: T, operationId: string) => Promise<string>): Promise<Result> {
  return db.serializable(async tx => {
    await tx.authorize(id);
    const claim = await tx.claim(id);
    if (claim.replay) {
      await tx.verifyReplay(id, claim.replay);
      return Object.freeze({ ...claim.replay });
    }
    const result = Object.freeze({ operationId: claim.operationId, effectId: await effect(tx, claim.operationId) });
    text(result.operationId); text(result.effectId);
    await tx.audit(id, result);
    await tx.complete(id, result);
    return result;
  });
}

export type Destination = Readonly<{ bankName: string; beneficiary: string; rib: string }>;
export type Withdrawal = Readonly<{ id: string; sellerId: string; amount: string; remaining: string;
  status: 'HELD' | 'RELEASED' | 'SETTLED'; payout: 'UNSENT' | 'SENDING' | 'UNKNOWN' | 'CONFIRMED';
  destinationHash: string; payoutEvidenceId: string | null }>;
export type WalletCommand =
  | Readonly<{ kind: 'DEPOSIT_APPROVAL'; requestId: string; fundingEvidenceId: string }>
  | Readonly<{ kind: 'WITHDRAWAL_REQUEST'; withdrawalId: string; amount: string; destination: Destination }>
  | Readonly<{ kind: 'WITHDRAWAL_REJECTION'; withdrawalId: string; reason: string }>
  | Readonly<{ kind: 'WITHDRAWAL_APPROVAL'; withdrawalId: string; payoutEvidenceId: string }>;
export interface WalletTransaction extends OperationTransaction {
  lockWallet(sellerId: string): Promise<WalletState>;
  lockWithdrawal(sellerId: string, withdrawalId: string): Promise<Withdrawal>;
  // Must prove request PENDING, same seller/currency, positive amount and unclaimed
  // bank/account/transfer evidence. applyWallet must claim evidence atomically.
  lockVerifiedDeposit(sellerId: string, requestId: string, evidenceId: string): Promise<{ sellerId: string; amount: string }>;
  verifyPayout(withdrawal: Withdrawal, evidenceId: string): Promise<void>;
  // Writes request/hold or release/consume state, exact wallet event/projection,
  // and balanced journal for CASH effects only, together. No zero-money journal
  // for HOLD/RELEASE. Must CAS original state and enforce all DB invariants.
  applyWallet(operationId: string, sellerId: string, command: WalletCommand,
    transition: ReturnType<typeof walletTransition>): Promise<string>;
}
export async function proposedWallet(db: Database<WalletTransaction>, envelope: Envelope, input: WalletCommand) {
  // Explicit canonical copy prevents caller mutation across awaits and binds ALL
  // meaningful fields. Bank destination belongs in private facts, not audit text.
  let command: WalletCommand;
  switch (input.kind) {
    case 'DEPOSIT_APPROVAL': command = Object.freeze({ kind: input.kind, requestId: text(input.requestId), fundingEvidenceId: text(input.fundingEvidenceId) }); break;
    case 'WITHDRAWAL_REQUEST': {
      const destination = Object.freeze({ bankName: text(input.destination.bankName), beneficiary: text(input.destination.beneficiary), rib: input.destination.rib });
      if (!/^\d{24}$/.test(destination.rib)) throw new Error('RIB must contain 24 digits');
      command = Object.freeze({ kind: input.kind, withdrawalId: text(input.withdrawalId), amount: positive(input.amount), destination }); break;
    }
    case 'WITHDRAWAL_REJECTION': command = Object.freeze({ kind: input.kind, withdrawalId: text(input.withdrawalId), reason: text(input.reason) }); break;
    case 'WITHDRAWAL_APPROVAL': command = Object.freeze({ kind: input.kind, withdrawalId: text(input.withdrawalId), payoutEvidenceId: text(input.payoutEvidenceId) }); break;
    default: throw new Error('Unsupported wallet command');
  }
  const businessKey = command.kind === 'DEPOSIT_APPROVAL' ? command.requestId : command.withdrawalId;
  const id = identity(envelope, command.kind, businessKey, command);
  return run(db, id, async (tx, operationId) => {
    const wallet = await tx.lockWallet(id.sellerId);
    let change: ReturnType<typeof walletTransition>;
    if (command.kind === 'DEPOSIT_APPROVAL') {
      const deposit = await tx.lockVerifiedDeposit(id.sellerId, command.requestId, command.fundingEvidenceId);
      if (deposit.sellerId !== id.sellerId) throw new Error('Deposit seller mismatch');
      change = walletTransition(wallet, 'CREDIT', positive(deposit.amount));
    } else if (command.kind === 'WITHDRAWAL_REQUEST') {
      change = walletTransition(wallet, 'HOLD', command.amount);
    } else {
      const withdrawal = await tx.lockWithdrawal(id.sellerId, command.withdrawalId);
      if (withdrawal.id !== command.withdrawalId || withdrawal.sellerId !== id.sellerId || withdrawal.status !== 'HELD') throw new Error('Active seller hold required');
      const amount = positive(withdrawal.amount);
      if (money(withdrawal.remaining) !== money(amount)) throw new Error('Whole hold required');
      if (command.kind === 'WITHDRAWAL_REJECTION') {
        if (withdrawal.payout !== 'UNSENT') throw new Error('Uncertain or sent payout must remain held');
        change = walletTransition(wallet, 'RELEASE', amount, withdrawal.remaining);
      } else {
        if (withdrawal.payout !== 'CONFIRMED' || withdrawal.payoutEvidenceId !== command.payoutEvidenceId) throw new Error('Confirmed payout evidence required');
        await tx.verifyPayout(withdrawal, command.payoutEvidenceId);
        change = walletTransition(wallet, 'CONSUME', amount, withdrawal.remaining);
      }
    }
    return tx.applyWallet(operationId, id.sellerId, command, change);
  });
}

export type StockCommand = Readonly<{ kind: 'RESERVE' | 'RELEASE' | 'RECEIVE_RETURN' | 'RESTOCK' | 'DISPOSE_DAMAGED' | 'LOSS';
  businessKey: string; productId: string; sourceId: string; quantity: number; evidenceId: string }>;
export type StockFacts = Readonly<{ sellerId: string; productId: string; sourceId: string; stock: StockState;
  remaining: number; authorized: boolean; disposition?: 'SELLABLE' | 'DAMAGED';
  lossSource?: 'IN_TRANSIT' | 'RETURNED_PENDING_INSPECTION' }>;
export interface StockTransaction extends OperationTransaction {
  // Lock stock/product before reservation/shipment/receipt/disposition in agreed
  // global order. Return authoritative source and conserved remaining quantities.
  // RESERVE requires paid/approved transaction context; never a separate HTTP
  // reservation after payment. RELEASE requires approved cancellation context.
  lockStockFacts(sellerId: string, command: StockCommand): Promise<StockFacts>;
  // CAS source counters, movement + projection, required evidence/source links.
  // LOSS consumes source; no restock, refund, journal or insurance payment.
  applyStock(operationId: string, command: StockCommand, next: StockState): Promise<string>;
}
export async function proposedStock(db: Database<StockTransaction>, envelope: Envelope, input: StockCommand) {
  if (!['RESERVE', 'RELEASE', 'RECEIVE_RETURN', 'RESTOCK', 'DISPOSE_DAMAGED', 'LOSS'].includes(input.kind)) throw new Error('Unsupported stock command');
  const command = Object.freeze({ kind: input.kind, businessKey: text(input.businessKey), productId: text(input.productId),
    sourceId: text(input.sourceId), quantity: units(input.quantity), evidenceId: text(input.evidenceId) });
  const id = identity(envelope, command.kind, command.businessKey, command);
  return run(db, id, async (tx, operationId) => {
    const facts = await tx.lockStockFacts(id.sellerId, command);
    if (facts.sellerId !== id.sellerId || facts.productId !== command.productId || facts.sourceId !== command.sourceId || !facts.authorized) throw new Error('Authorized seller stock source required');
    if (!Number.isInteger(facts.remaining) || facts.remaining < command.quantity || facts.remaining > 2147483647) throw new Error('Source quantity exhausted');
    let next: StockState;
    if (command.kind === 'LOSS') {
      // Validate every bucket before subtraction; loss never creates availability.
      const source = facts.lossSource;
      if (source !== 'IN_TRANSIT' && source !== 'RETURNED_PENDING_INSPECTION') throw new Error('Verified loss source required');
      for (const value of Object.values(facts.stock)) if (!Number.isInteger(value) || value < 0 || value > 2147483647) throw new Error('Corrupt stock projection');
      if (facts.stock[source] < command.quantity) throw new Error('Insufficient loss source');
      next = Object.freeze({ ...facts.stock, [source]: facts.stock[source] - command.quantity });
    } else {
      next = stockTransition(facts.stock, command.kind, command.quantity,
        facts.disposition ? { disposition: facts.disposition, remaining: facts.remaining } : undefined);
    }
    return tx.applyStock(operationId, command, next);
  });
}

export interface CaptureTransaction extends OperationTransaction {
  // Read/lock authoritative product prices in this creation transaction.
  readProductForCapture(productId: string): Promise<{ id: string; sellerPrice: string; costPrice: string }>;
  // Create NEW order line + immutable version 1 snapshot in this transaction;
  // existing order or snapshot is a conflict, never an upsert/reprice/backfill.
  createLineAndSnapshot(operationId: string, sellerId: string, orderId: string, productId: string,
    quantity: number, cost: CostSnapshot): Promise<string>;
}
export async function proposedCapture(db: Database<CaptureTransaction>, envelope: Envelope,
  input: { orderId: string; productId: string; quantity: number }) {
  const command = Object.freeze({ orderId: text(input.orderId), productId: text(input.productId), quantity: units(input.quantity) });
  const id = identity(envelope, 'ORDER_COST_CAPTURE', command.orderId, command);
  return run(db, id, async (tx, operationId) => {
    const product = await tx.readProductForCapture(command.productId);
    if (product.id !== command.productId) throw new Error('Product capture mismatch');
    const cost = snapshot({ sellerUnitCost: product.sellerPrice, supplierUnitCost: product.costPrice, source: 'AT_CREATION', evidence: null });
    return tx.createLineAndSnapshot(operationId, id.sellerId, command.orderId, command.productId, command.quantity, cost);
  });
}

export interface InspectionTransaction extends OperationTransaction {
  lockReceipt(sellerId: string, receiptId: string): Promise<{ sellerId: string; receiptId: string; uninspected: number }>;
  // Append immutable SELLABLE/DAMAGED dispositions and consume uninspected units
  // using CAS. Inspection records evidence; it does NOT move stock or refund.
  recordInspection(operationId: string, receiptId: string, accepted: number, damaged: number, evidenceId: string): Promise<string>;
}
export async function proposedInspection(db: Database<InspectionTransaction>, envelope: Envelope,
  input: { inspectionId: string; receiptId: string; accepted: number; damaged: number; evidenceId: string }) {
  const command = Object.freeze({ inspectionId: text(input.inspectionId), receiptId: text(input.receiptId),
    accepted: input.accepted, damaged: input.damaged, evidenceId: text(input.evidenceId) });
  for (const count of [command.accepted, command.damaged]) if (!Number.isInteger(count) || count < 0 || count > 2147483647) throw new Error('Invalid inspection quantity');
  const total = units(command.accepted + command.damaged);
  const id = identity(envelope, 'INSPECT_RETURN', command.inspectionId, command);
  return run(db, id, async (tx, operationId) => {
    const receipt = await tx.lockReceipt(id.sellerId, command.receiptId);
    if (receipt.sellerId !== id.sellerId || receipt.receiptId !== command.receiptId ||
      !Number.isInteger(receipt.uninspected) || receipt.uninspected < total || receipt.uninspected > 2147483647) throw new Error('Insufficient physically received uninspected units');
    return tx.recordInspection(operationId, command.receiptId, command.accepted, command.damaged, command.evidenceId);
  });
}

export interface ReconciliationTransaction extends OperationTransaction {
  // ADMIN-only review. Must verify immutable source artifact/hash, carrier account,
  // statement ownership/currency, expected seller scope and stable source row IDs.
  loadVerifiedStatement(sellerId: string, statementId: string, evidenceId: string): Promise<{
    sellerId: string; statementId: string; evidenceId: string; expected: ExpectedSettlement[]; observed: ObservedSettlement[];
  }>;
  // Append review + source evidence + findings, no auto match activation, remittance,
  // wallet event, profit recognition or invented carrier/bank evidence.
  appendReconciliationReview(operationId: string, statementId: string, evidenceId: string,
    findings: ReturnType<typeof reconcile>): Promise<string>;
}
export async function proposedReconciliation(db: Database<ReconciliationTransaction>, envelope: Envelope,
  input: { reviewId: string; statementId: string; evidenceId: string }) {
  const command = Object.freeze({ reviewId: text(input.reviewId), statementId: text(input.statementId), evidenceId: text(input.evidenceId) });
  const id = identity(envelope, 'SETTLEMENT_REVIEW', command.reviewId, command);
  return run(db, id, async (tx, operationId) => {
    const evidence = await tx.loadVerifiedStatement(id.sellerId, command.statementId, command.evidenceId);
    if (evidence.sellerId !== id.sellerId || evidence.statementId !== command.statementId || evidence.evidenceId !== command.evidenceId ||
      evidence.expected.some(row => row.sellerId !== id.sellerId)) throw new Error('Settlement evidence scope mismatch');
    const findings = reconcile(evidence.expected, evidence.observed);
    return tx.appendReconciliationReview(operationId, command.statementId, command.evidenceId, findings);
  });
}
