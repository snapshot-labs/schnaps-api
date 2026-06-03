import { Plan, TURBO_PRICE_CENTS } from '../config';
import { stripe } from './client';

export type CheckoutInput = {
  space: string;
  plan: Plan;
  successUrl: string;
  cancelUrl: string;
};

export async function createTurboCheckoutSession({
  space,
  plan,
  successUrl,
  cancelUrl
}: CheckoutInput) {
  if (!stripe) throw new Error('STRIPE_SECRET_KEY not configured');

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: `Snapshot Pro (${space})` },
          unit_amount: TURBO_PRICE_CENTS[plan],
          recurring: { interval: plan === 'yearly' ? 'year' : 'month' }
        },
        quantity: 1
      }
    ],
    subscription_data: { metadata: { space } },
    success_url: successUrl,
    cancel_url: cancelUrl
  });
}
