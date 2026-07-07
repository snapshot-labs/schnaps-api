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

export type StripeCharge = {
  id: string;
  created: number;
  status: string;
  payment_intent: string | { id: string } | null;
};

export type StripeRefund = {
  id: string;
  amount: number;
  created: number;
  status: string | null;
  payment_intent: string | { id: string } | null;
};

export type StripeSubscriptionEvent = {
  id: string;
  created: number;
  data: { object: unknown };
};

type CanceledSubscription = {
  metadata: Record<string, string> | null;
  cancellation_details: { reason: string | null } | null;
};

export async function indexPayment(charge: StripeCharge): Promise<void> {
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

export async function refundPayment(refund: StripeRefund): Promise<void> {
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

export async function cancelSubscription(
  event: StripeSubscriptionEvent
): Promise<void> {
  const subscription = event.data.object as CanceledSubscription;
  const space = subscription.metadata?.space;
  if (!space) return;

  console.log('[stripe] subscription canceled for space', space);

  // End turbo at the cancellation time; leave an already-lapsed space untouched.
  const spaceEntity = await Space.loadEntity(space, NETWORK);
  if (spaceEntity && spaceEntity.turbo_expiration > event.created) {
    spaceEntity.turbo_expiration = event.created;
    spaceEntity.turbo_expiration_date = new Date(
      event.created * 1000
    ).toDateString();
    await spaceEntity.save();
  }

  notifyStripeCancellation(
    space,
    event.created,
    subscription.cancellation_details?.reason
  );
}
