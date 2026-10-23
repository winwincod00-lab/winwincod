import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import prisma from '@/lib/prisma';

// New manual operations only; never deduplicate/backfill historical ADMIN_TOPUP rows.
export async function manualTopup(actorId: string, key: string | null, targetUserId: string, amount: number, note: string) {
  if (!actorId || !key || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) throw new Error('Valid Idempotency-Key required');
  const value = new Prisma.Decimal(amount);
  if (!value.isFinite() || !value.gt(0)) throw new Error('Invalid amount');
  const operationId = 'admin-topup:' + createHash('sha256').update(JSON.stringify([actorId, key.toLowerCase()])).digest('hex');
  const fingerprint = createHash('sha256').update(JSON.stringify([targetUserId, value.toString(), note])).digest('hex');
  async function recover(db: Pick<Prisma.TransactionClient, 'log' | 'wallet' | 'transaction'>) {
    const receipt = await db.log.findUnique({ where: { id: operationId } });
    if (!receipt) return null;
    if (receipt.userId !== actorId || receipt.action !== 'ADMIN_MANUAL_TOPUP' || JSON.parse(receipt.details ?? '{}').fingerprint !== fingerprint) throw new Error('Operation key already used with different data');
    const wallet = await db.wallet.findUniqueOrThrow({ where: { userId: targetUserId } });
    const entries = await db.transaction.findMany({ where: { walletId: wallet.id, referenceId: operationId, type: 'DEPOSIT' } });
    if (entries.length !== 1 || !new Prisma.Decimal(entries[0].amount).eq(value)) throw new Error('Ledger mismatch: manual reconciliation required');
    return { wallet, replayed: true };
  }
  const previous = await recover(prisma);
  if (previous) return previous;
  try {
    return await prisma.$transaction(async tx => {
      const seller = await tx.user.findUnique({ where: { id: targetUserId }, select: { role: true } });
      if (seller?.role !== 'SELLER') throw new Error('Seller not found');
      // Unique claim, exact balance increment, real ledger and audit commit together.
      await tx.log.create({ data: { id: operationId, userId: actorId, action: 'ADMIN_MANUAL_TOPUP', details: JSON.stringify({ fingerprint, targetUserId, amount: value.toString() }) } });
      const wallet = await tx.wallet.update({ where: { userId: targetUserId }, data: { balance: { increment: value } } });
      await tx.transaction.create({ data: { walletId: wallet.id, amount: value, type: 'DEPOSIT', referenceId: operationId, description: note || 'شحن رصيد من قبل الإدارة' } });
      return { wallet, replayed: false };
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    // Read-only recovery after a uniqueness conflict or lost commit response.
    const saved = await recover(prisma);
    if (saved) return saved;
    throw error;
  }
}
