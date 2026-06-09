import { Payment, Space } from '../../.checkpoint/models';
import { NETWORK } from '../config';
import {
  notifyStripeCancellation,
  notifyStripePayment,
  notifyStripeRefund
} from '../discord';
import { sleep } from '../utils';
import { computeExpirationFromAmount } from '../writers';
import { stripe } from './client';

const POLL_INTERVAL = 15_000; // 15 seconds
const CENTS_TO_RAW = 10000n; // USD cents → 6-decimal token raw (10^6 / 10^2)

const nowSeconds = () => Math.floor(Date.now() / 1000);

type StripeInvoice = {
  id: string;
  amount_paid: number;
  created: number;
  livemode: boolean;
  parent: {
    subscription_details: {
      metadata: Record<string, string> | null;
    } | null;
  } | null;
};

type CanceledSubscription = {
  metadata: Record<string, string> | null;
  cancellation_details: { reason: string | null } | null;
};

type RefundedCharge = {
  payment_intent: string | null;
};

export async function indexInvoice(invoice: StripeInvoice): Promise<void> {
  const space = invoice.parent?.subscription_details?.metadata?.space;
  const amountCents = invoice.amount_paid;

  if (!space || !amountCents) {
    console.error('[stripe] invoice missing space/amount_paid', invoice.id);
    return;
  }

  const paymentId = `stripe:${invoice.id}`;
  if (await Payment.loadEntity(paymentId, NETWORK)) return;

  console.log('[stripe] payment received for space', space);

  const amountRaw = BigInt(amountCents) * CENTS_TO_RAW;
  const timestamp = invoice.created;

  const payment = new Payment(paymentId, NETWORK);
  payment.sender = 'stripe';
  payment.token_address = 'stripe';
  payment.token_symbol = 'USD';
  payment.amount_raw = amountRaw;
  payment.amount_decimal = (amountCents / 100).toString();
  payment.barcode = '';
  payment.block = 0;
  payment.timestamp = timestamp;
  payment.type = 'turbo';
  payment.space = space;
  await payment.save();

  let spaceEntity = await Space.loadEntity(space, NETWORK);
  if (!spaceEntity) spaceEntity = new Space(space, NETWORK);

  const expirationDate = computeExpirationFromAmount(
    amountRaw,
    spaceEntity.turbo_expiration,
    timestamp
  );
  spaceEntity.turbo_expiration = expirationDate.getTime() / 1000;
  spaceEntity.turbo_expiration_date = expirationDate.toDateString();
  await spaceEntity.save();

  notifyStripePayment(payment, spaceEntity, invoice.livemode);
}

async function indexPaidInvoices(since: number): Promise<void> {
  if (!stripe) return;

  const invoices = await Array.fromAsync(
    stripe.invoices.list({
      status: 'paid',
      created: { gte: since },
      limit: 100
    })
  );
  // Oldest first: expiration accumulates in the order payments were made.
  invoices.sort((a, b) => a.created - b.created);

  for (const invoice of invoices) {
    try {
      await indexInvoice(invoice);
    } catch (err) {
      console.error('[stripe] indexer: failed to index', invoice.id, err);
    }
  }
}

async function refundPayment(
  charge: RefundedCharge,
  timestamp: number
): Promise<void> {
  if (!stripe || !charge.payment_intent) return;

  const [invoicePayment] = await Array.fromAsync(
    stripe.invoicePayments.list({
      payment: { type: 'payment_intent', payment_intent: charge.payment_intent }
    })
  );

  const invoice = invoicePayment?.invoice;
  const invoiceId = typeof invoice === 'string' ? invoice : invoice?.id;
  if (!invoiceId) return;

  const payment = await Payment.loadEntity(`stripe:${invoiceId}`, NETWORK);
  if (!payment) return;

  const space = payment.space;
  console.log('[stripe] refund for space', space);
  await payment.delete();

  const spaceEntity = await Space.loadEntity(space, NETWORK);
  if (spaceEntity) {
    const reductionSeconds =
      computeExpirationFromAmount(payment.amount_raw, 0, 0).getTime() / 1000;
    const expiration = spaceEntity.turbo_expiration - reductionSeconds;
    spaceEntity.turbo_expiration = expiration;
    spaceEntity.turbo_expiration_date = new Date(
      expiration * 1000
    ).toDateString();
    await spaceEntity.save();
  }

  notifyStripeRefund(space, timestamp, payment.amount_decimal);
}

async function handleStripeEvents(since: number): Promise<void> {
  if (!stripe) return;

  const events = await Array.fromAsync(
    stripe.events.list({
      types: ['charge.refunded', 'customer.subscription.deleted'],
      created: { gte: since },
      limit: 100
    })
  );

  for (const event of events) {
    try {
      if (event.type === 'charge.refunded') {
        await refundPayment(event.data.object as RefundedCharge, event.created);
      } else {
        const subscription = event.data.object as CanceledSubscription;
        const space = subscription.metadata?.space;
        if (space) {
          await notifyStripeCancellation(
            space,
            event.created,
            subscription.cancellation_details?.reason
          );
        }
      }
    } catch (err) {
      console.error('[stripe] indexer: failed to handle', event.type, err);
    }
  }
}

export async function startStripeIndexer(): Promise<void> {
  if (!stripe) return;

  let cursor = 0;

  while (true) {
    const polledAt = nowSeconds();
    try {
      await indexPaidInvoices(cursor);
      await handleStripeEvents(cursor);
      cursor = polledAt;
    } catch (err) {
      console.error('[stripe] indexer: poll failed', err);
    }
    await sleep(POLL_INTERVAL);
  }
}
