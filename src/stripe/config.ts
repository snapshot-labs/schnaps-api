import { CheckpointConfig } from '@snapshot-labs/checkpoint';

export const WINDOW = 3600; // a "block" is a 1h time window
const STRIPE_START_TS = 1767225600; // 2026-01-01, before the first payment

export const stripeConfig: CheckpointConfig = {
  network_node_url: 'https://api.stripe.com', // required by schema; never called
  optimistic_indexing: false,
  fetch_interval: 60_000,
  sources: [
    {
      contract: 'stripe',
      start: Math.floor(STRIPE_START_TS / WINDOW),
      events: []
    }
  ]
};
