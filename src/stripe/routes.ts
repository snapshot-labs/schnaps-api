import express, { Router } from 'express';
import { PLANS, TURBO_PRICE_CENTS } from '../config';
import { sendError } from '../utils';
import { stripe } from './client';

const router = Router();

router.post('/create', express.json(), async (req, res) => {
  if (!stripe) return sendError(res, 'stripe not configured');

  const { space, plan, ref, success_url, cancel_url } = req.body ?? {};

  if (typeof space !== 'string' || !/^[\w-]+:[\w.-]+$/.test(space)) {
    return sendError(res, 'missing or invalid space', 400);
  }

  if (!PLANS.includes(plan)) {
    return sendError(res, 'invalid plan', 400);
  }

  try {
    const { data } = await stripe.subscriptions.search({
      query: `status:'active' AND metadata['space']:'${space}'`,
      limit: 1
    });
    if (data.length) {
      return sendError(res, 'space already has an active subscription', 409);
    }

    const session = await stripe.checkout.sessions.create({
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
      subscription_data: {
        metadata: {
          space,
          ...(typeof ref === 'string' && ref && ref.length <= 100
            ? { ref }
            : {})
        }
      },
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

// Crypto payments never create a Stripe subscription, so any match is a card one
router.get('/subscription', async (req, res) => {
  if (!stripe) return res.json({ result: { stripeAvailable: false } });

  const { space } = req.query;
  if (typeof space !== 'string' || !/^[\w-]+:[\w.-]+$/.test(space)) {
    return sendError(res, 'missing or invalid space', 400);
  }

  try {
    const { data } = await stripe.subscriptions.search({
      query: `status:'active' AND metadata['space']:'${space}'`,
      limit: 1
    });
    const subscription = data[0];
    return res.json({
      result: {
        stripeAvailable: true,
        activeSubscription: !!subscription,
        cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
        renewsAt: subscription?.items.data[0]?.current_period_end ?? null
      }
    });
  } catch (err) {
    console.error('[stripe] /subscription failed:', err);
    return sendError(res, err instanceof Error ? err.message : 'failed');
  }
});

export default router;
