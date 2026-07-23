import { Payment, Space } from '../../.checkpoint/models';
import { NETWORK } from '../config';
import {
  notifyStripeCancellation,
  notifyStripePayment,
  notifyStripeRefund
} from '../discord';
import { computeExpirationFromAmount } from '../writers';
import { stripe } from './client';

const CENTS_TO_RAW = 10000n; // USD cents → 6-decimal token raw (10^6 / 10^2)

export type StripeItem = { id: string; created: number };
export type StripeWriter = (item: StripeItem) => Promise<void>;

type StripeCharge = StripeItem & {
  status: string;
  payment_intent: string | { id: string } | null;
};

type StripeRefund = StripeItem & {
  amount: number;
  status: string | null;
  payment_intent: string | { id: string } | null;
};

type StripeSubscriptionEvent = StripeItem & {
  data: { object: unknown; previous_attributes?: unknown };
};

type Subscription = {
  cancel_at: number | null;
  metadata: Record<string, string> | null;
  cancellation_details: { feedback: string | null } | null;
};

export function createStripeWriters(): Record<string, StripeWriter> {
  return { handleCharge, handleRefund, handleSubscriptionUpdated };
}

async function handleCharge(item: StripeItem): Promise<void> {
  const charge = item as StripeCharge;
  const paymentIntent = charge.payment_intent;
  const paymentIntentId =
    typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id;
  if (!stripe || charge.status !== 'succeeded' || !paymentIntentId) return;

  // The space label lives only on the invoice; resolve it from the charge.
  const invoicePayments = await stripe.invoicePayments.list({
    payment: { type: 'payment_intent', payment_intent: paymentIntentId },
    limit: 1,
    expand: ['data.invoice']
  });

  const invoice = invoicePayments.data[0]?.invoice;
  if (!invoice || typeof invoice === 'string' || 'deleted' in invoice) return;

  const space = invoice.parent?.subscription_details?.metadata?.space;
  const ref = invoice.parent?.subscription_details?.metadata?.ref;
  const amountCents = invoice.amount_paid;

  if (!space || !amountCents) {
    console.error('[stripe] invoice missing space/amount_paid', invoice.id);
    return;
  }

  const paymentId = `stripe:${invoice.id}`;
  if (await Payment.loadEntity(paymentId, NETWORK)) return;

  console.log('[stripe] payment received for space', space);

  const amountRaw = BigInt(amountCents) * CENTS_TO_RAW;
  const timestamp = charge.created;

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
  if (typeof ref === 'string' && ref) payment.ref = ref;
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

async function handleRefund(item: StripeItem): Promise<void> {
  const refund = item as StripeRefund;
  const paymentIntent = refund.payment_intent;
  const paymentIntentId =
    typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id;
  if (!stripe || refund.status !== 'succeeded' || !paymentIntentId) return;

  const invoicePayments = await stripe.invoicePayments.list({
    payment: { type: 'payment_intent', payment_intent: paymentIntentId },
    limit: 1
  });

  const invoice = invoicePayments.data[0]?.invoice;
  const invoiceId = typeof invoice === 'string' ? invoice : invoice?.id;
  if (!invoiceId) return;

  const payment = await Payment.loadEntity(`stripe:${invoiceId}`, NETWORK);
  if (!payment) return;

  const space = payment.space;
  const refundAmountRaw = BigInt(refund.amount) * CENTS_TO_RAW;
  const refundAmountDecimal = (refund.amount / 100).toString();
  console.log('[stripe] refund for space', space);
  if (refundAmountRaw >= payment.amount_raw) {
    await payment.delete();
  }

  const spaceEntity = await Space.loadEntity(space, NETWORK);
  if (spaceEntity) {
    const reductionSeconds =
      computeExpirationFromAmount(refundAmountRaw, 0, 0).getTime() / 1000;
    const expiration = spaceEntity.turbo_expiration - reductionSeconds;
    spaceEntity.turbo_expiration = expiration;
    spaceEntity.turbo_expiration_date = new Date(
      expiration * 1000
    ).toDateString();
    await spaceEntity.save();
  }

  notifyStripeRefund(space, refund.created, refundAmountDecimal);
}

async function handleSubscriptionUpdated(item: StripeItem): Promise<void> {
  const event = item as StripeSubscriptionEvent;
  const subscription = event.data.object as Subscription;
  const prev = (event.data.previous_attributes ?? {}) as Partial<Subscription>;
  const space = subscription.metadata?.space;
  if (!space) return;

  // Portal cancellations schedule at period end, so only `updated` fires;
  // the cancel_at null → set transition filters out other subscription edits.
  if (prev.cancel_at !== null || !subscription.cancel_at) return;

  console.log('[stripe] subscription canceled for space', space);

  notifyStripeCancellation(
    space,
    event.created,
    subscription.cancellation_details?.feedback,
    subscription.cancel_at
  );
}
