import {
  BaseIndexer,
  BaseProvider,
  BlockNotFoundError
} from '@snapshot-labs/checkpoint';
import { stripe } from './client';
import { WINDOW } from './config';
import {
  cancelSubscription,
  indexPayment,
  refundPayment,
  StripeCharge,
  StripeRefund,
  StripeSubscriptionEvent
} from './writers';

const SUBSCRIPTION_DELETED = 'customer.subscription.deleted';

type WindowData = {
  charges: StripeCharge[];
  refunds: StripeRefund[];
  cancellations: StripeSubscriptionEvent[];
};

async function fetchWindowData(from: number, to: number): Promise<WindowData> {
  if (!stripe) return { charges: [], refunds: [], cancellations: [] };

  const [charges, refunds, cancellations] = await Promise.all([
    Array.fromAsync(
      stripe.charges.list({
        created: { gte: from, lt: to },
        limit: 100
      })
    ),
    Array.fromAsync(
      stripe.refunds.list({
        created: { gte: from, lt: to },
        limit: 100
      })
    ),
    // events.list retains only ~30 days, so cancellations are not replayable;
    // fine for notification-only. If cancellation ever mutates state again,
    // switch to a durable source (subscriptions.list, no ended_at range filter).
    Array.fromAsync(
      stripe.events.list({
        type: SUBSCRIPTION_DELETED,
        created: { gte: from, lt: to },
        limit: 100
      })
    )
  ]);

  return { charges, refunds, cancellations };
}

async function processWindow(data: WindowData): Promise<void> {
  // Oldest first: expiration accumulates in the order payments were made.
  data.charges.sort((a, b) => a.created - b.created);
  for (const charge of data.charges) {
    try {
      await indexPayment(charge);
    } catch (err) {
      console.error('[stripe] indexer: failed to index', charge.id, err);
    }
  }

  for (const refund of data.refunds) {
    try {
      await refundPayment(refund);
    } catch (err) {
      console.error('[stripe] indexer: failed to refund', refund.id, err);
    }
  }

  for (const event of data.cancellations) {
    try {
      await cancelSubscription(event);
    } catch (err) {
      console.error('[stripe] indexer: failed to cancel', event.id, err);
    }
  }
}

class StripeProvider extends BaseProvider {
  private windowsCache = new Map<number, WindowData>();

  formatAddresses(addresses: string[]): string[] {
    return addresses;
  }

  async getNetworkIdentifier(): Promise<string> {
    return 'stripe';
  }

  async getLatestBlockNumber(): Promise<number> {
    return ~~(Date.now() / 1000 / WINDOW);
  }

  async getBlockHash(blockNumber: number): Promise<string> {
    return String(blockNumber);
  }

  async processBlock(blockNumber: number): Promise<number> {
    if (blockNumber >= (await this.getLatestBlockNumber())) {
      throw new BlockNotFoundError(); // window still open
    }

    const data =
      this.windowsCache.get(blockNumber) ??
      (await fetchWindowData(blockNumber * WINDOW, (blockNumber + 1) * WINDOW));
    this.windowsCache.delete(blockNumber);

    await processWindow(data);
    await this.instance.setBlockHash(
      blockNumber,
      await this.getBlockHash(blockNumber)
    );
    await this.instance.setLastIndexedBlock(blockNumber);

    return blockNumber + 1;
  }

  async getCheckpointsRange(
    fromBlock: number,
    toBlock: number
  ): Promise<{ blockNumber: number; contractAddress: string }[]> {
    const data = await fetchWindowData(
      fromBlock * WINDOW,
      (toBlock + 1) * WINDOW
    );

    const windows = new Set<number>();
    const bucketFor = (created: number): WindowData => {
      const block = ~~(created / WINDOW);
      windows.add(block);
      let bucket = this.windowsCache.get(block);
      if (!bucket) {
        bucket = { charges: [], refunds: [], cancellations: [] };
        this.windowsCache.set(block, bucket);
      }
      return bucket;
    };

    for (const charge of data.charges) {
      bucketFor(charge.created).charges.push(charge);
    }
    for (const refund of data.refunds) {
      bucketFor(refund.created).refunds.push(refund);
    }
    for (const event of data.cancellations) {
      bucketFor(event.created).cancellations.push(event);
    }

    return [...windows].map(blockNumber => ({
      blockNumber,
      contractAddress: 'stripe'
    }));
  }
}

export class StripeIndexer extends BaseIndexer {
  init(args: Parameters<BaseIndexer['init']>[0]): void {
    this.provider = new StripeProvider(args);
  }

  getHandlers(): string[] {
    return [];
  }
}
