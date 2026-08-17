# Payment Indexer

Indexes Snapshot Pro ("turbo") payments and exposes them over GraphQL. Two
payment paths feed the same `Payment` / `Space` tables, so billing and turbo
enforcement don't care where the money came from:

- **Onchain (EVM)** — the `Schnaps` contract on Ethereum (Sepolia for testnet).
- **Stripe** — card subscriptions for Snapshot Pro.

Both run on [`@snapshot-labs/checkpoint`](https://github.com/snapshot-labs/checkpoint).

## How it works

Each indexer is a `config` + `writers` pair registered with `checkpoint.addIndexer`
(see `src/index.ts`). The config's `sources[].events` map an event to a writer
`fn`; checkpoint validates every `fn` against the indexer's handlers and calls it
per matching event.

- **EVM** (`src/config.ts`, `src/writers.ts`) — the built-in `evm.EvmIndexer`
  matches contract logs to `handlePaymentReceived`, which writes the `Payment`
  and extends `Space.turbo_expiration`.
- **Stripe** (`src/stripe/`) — same shape. `config.ts` declares the sources
  (`charge` → `indexPayment`, `refund` → `refundPayment`,
  `customer.subscription.deleted` → `cancelSubscription`); `writers.ts` exports
  them via `createStripeWriters`. Stripe has no blocks, so `indexer.ts` maps each
  1h window to a "block" and polls the durable Stripe resources (charges,
  refunds, events) for that window — no webhook, and replay stays correct on
  every boot. A charge grants/extends turbo, a full refund removes the period, a
  cancellation only notifies (the paid period stands).

Payments and expirations are announced to Discord. A background monitor
(`src/expirationMonitor.ts`) runs every 5 minutes. It posts spaces that are
expiring or recently expired (at most once a day), and it alerts on the EVM
indexer falling behind, in either of two ways: the indexed block has not
increased for 15 minutes, or it has been more than `SYNC_THRESHOLD_BLOCKS`
behind the chain head for 30 minutes. The first catches a hard stop, the second
catches a crawl. Neither reads the chain head as part of deciding a stall, so a
dead RPC endpoint cannot switch the alerting off.

Both windows have to stay clear of a boot replay, which resets the cursor to 0
and re-indexes from `sources[].start`. That replay strides between blocks
carrying a matching log rather than walking every block, so its duration and its
longest pause depend on `start` and on how sparse `PaymentReceived` is. Moving
`start` much further back is the change that would need these windows revisited.

The monitor runs inside the process it watches, so it cannot report that process
exiting, being OOM-killed, or failing to boot. That needs an external check and
there is none yet.

## HTTP endpoints

- `POST /stripe/create` — `{ space, plan, success_url, cancel_url }` → a Stripe
  Checkout URL (`plan` is `monthly` or `yearly`).
- `GET /stripe/portal` — the Stripe Customer Portal login URL.
- `/` — the GraphQL API for indexed payments and spaces.

## Run it

```sh
yarn                # install
yarn codegen        # generate models from src/schema.gql
yarn dev            # watch mode (runs codegen first)
```

`yarn build` compiles to `dist/`, `yarn start` runs it. Requires a PostgreSQL
database (`DATABASE_URL`); the DB is reset and replayed on every boot.

## Configuration

Copy `.env.example` to `.env`:

- `DATABASE_URL` — PostgreSQL connection string (required).
- `STRIPE_SECRET_KEY` — enables the Stripe indexer and endpoints; omit to disable.
- `DISCORD_WEBHOOK_URL` — payment notifications.
- `DISCORD_EXPIRATION_WEBHOOK_URL` — expiration monitor notifications.
- `DISCORD_ALERT_WEBHOOK_URL`: indexer stall alerts. Falls back to
  `DISCORD_EXPIRATION_WEBHOOK_URL`.
- `ADMIN_ADDRESS` — address whose zero-amount payments set expiration directly.
- `INDEX_TESTNET` — index Sepolia instead of Ethereum.
