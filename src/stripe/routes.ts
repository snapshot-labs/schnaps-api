import express, { Router } from 'express';
import { PLANS, TURBO_PRICE_CENTS } from '../config';
import { sendError } from '../utils';
import { stripe } from './client';

const router = Router();

router.post('/create', express.json(), async (req, res) => {
  if (!stripe) return sendError(res, 'stripe not configured');

  const { space, plan, email, success_url, cancel_url } = req.body ?? {};

  if (!space) {
    return sendError(res, 'missing space', 400);
  }

  if (!PLANS.includes(plan)) {
    return sendError(res, 'invalid plan', 400);
  }

  try {
    // Reuse an existing customer for this email so subscriptions consolidate;
    // for first-time buyers, let Checkout create it (prefilled) to avoid
    // orphan customers on abandoned sessions.
    let customer: string | undefined;
    if (email) {
      const existing = await stripe.customers.list({ email, limit: 1 });
      customer = existing.data[0]?.id;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      customer_email: customer ? undefined : email,
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
      success_url,
      cancel_url
    });
    return res.json({ result: { url: session.url } });
  } catch (err) {
    console.error('[stripe] /create failed:', err);
    return sendError(res, err instanceof Error ? err.message : 'failed');
  }
});

router.get('/portal', async (_req, res) => {
  if (!stripe) return sendError(res, 'stripe not configured');

  try {
    const configs = await stripe.billingPortal.configurations.list({
      is_default: true,
      active: true,
      limit: 1
    });
    const url = configs.data[0]?.login_page?.url;
    if (!url) return sendError(res, 'portal not configured');
    return res.json({ result: { url } });
  } catch (err) {
    console.error('[stripe] /portal failed:', err);
    return sendError(res, err instanceof Error ? err.message : 'failed');
  }
});

export default router;
