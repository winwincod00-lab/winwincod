import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

type Decision = 'APPROVED' | 'REJECTED';

// The existing request row is the operation identity. No synthetic ledger or backfill.
async function decide(kind: 'deposit' | 'withdrawal', id: string, decision: Decision, actorId: string, note?: string) {
  if (!actorId.trim()) throw new Error('Audit actor required');
  return prisma.$transaction(async tx => {
    const request = kind === 'deposit'
      ? await tx.depositrequest.findUnique({ where: { id } })
      : await tx.withdrawalrequest.findUnique({ where: { id } });
    if (!request) throw new Error('Request not found');
    const amount = new Prisma.Decimal(request.amount);
    if (!amount.isFinite() || !amount.gt(0)) throw new Error('Invalid request amount');
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: request.sellerId } });
    const entries = await tx.transaction.findMany({ where: { walletId: wallet.id, referenceId: id, type: kind === 'deposit' ? 'DEPOSIT' : 'WITHDRAWAL' } });
    if (decision === 'REJECTED' && entries.length !== 0) throw new Error('Ledger mismatch: manual reconciliation required');
    if (request.status === decision) {
      // Legacy APPROVED requests without a matching ledger must be reviewed, never repaired here.
      if (decision === 'APPROVED') {
        const expected = kind === 'deposit' ? amount : amount.negated();
        if (entries.length !== 1 || !new Prisma.Decimal(entries[0].amount).eq(expected)) throw new Error('Ledger mismatch: manual reconciliation required');
      }
      return { wallet, sellerId: request.sellerId, amount, replayed: true };
    }
    if (entries.length !== 0) throw new Error('Ledger exists for unapproved request: manual reconciliation required');
    if (request.status !== 'PENDING') throw new Error('Request already processed');
    if (kind === 'withdrawal' && decision === 'APPROVED' && !note) throw new Error('Payment receipt required');
    const claim = kind === 'deposit'
      ? await tx.depositrequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: decision, notes: note } })
      : await tx.withdrawalrequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: decision, ...(decision === 'APPROVED' ? { receiptImage: note } : {}) } });
    if (claim.count !== 1) throw new Error('Concurrent decision: refresh and retry');
    let updated = wallet;
    if (decision === 'APPROVED') {
      if (kind === 'withdrawal') {
        const debit = await tx.wallet.updateMany({ where: { id: wallet.id, balance: { gte: amount } }, data: { balance: { decrement: amount } } });
        if (debit.count !== 1) throw new Error('Insufficient balance');
        updated = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      } else {
        updated = await tx.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: amount } } });
      }
      await tx.transaction.create({ data: { walletId: wallet.id, amount: kind === 'deposit' ? amount : amount.negated(), type: kind === 'deposit' ? 'DEPOSIT' : 'WITHDRAWAL', referenceId: id, description: `${kind} approval` } });
    }
    await tx.log.create({ data: { userId: actorId, action: `${kind.toUpperCase()}_${decision}`, details: JSON.stringify({ requestId: id, sellerId: request.sellerId, amount: amount.toString() }) } });
    return { wallet: updated, sellerId: request.sellerId, amount, replayed: false };
  }, { isolationLevel: 'Serializable' });
}

export function decideDeposit(id: string, decision: Decision, actorId: string, reason?: string) {
  return decide('deposit', id, decision, actorId, reason);
}
export function decideWithdrawal(id: string, decision: Decision, actorId: string, receiptUrl?: string) {
  return decide('withdrawal', id, decision, actorId, receiptUrl);
}
