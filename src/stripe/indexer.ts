import {
  BaseIndexer,
  BaseProvider,
  BlockNotFoundError
} from '@snapshot-labs/checkpoint';
import { stripe } from './client';
import { STRIPE_EVENTS, WINDOW } from './config';
import { createStripeWriters, StripeItem, StripeWriter } from './writers';

type StripeSource = {
  fetch: (from: number, to: number) => Promise<StripeItem[]>;
  // Charges must run oldest-first: turbo accrues in payment order.
  ordered?: boolean;
};

const SOURCES: Record<string, StripeSource> = {
  [STRIPE_EVENTS.CHARGE]: {
    ordered: true,
    fetch: (from, to) =>
      Array.fromAsync(
        stripe!.charges.list({ created: { gte: from, lt: to }, limit: 100 })
      )
  },
  [STRIPE_EVENTS.REFUND]: {
    fetch: (from, to) =>
      Array.fromAsync(
        stripe!.refunds.list({ created: { gte: from, lt: to }, limit: 100 })
      )
  },
  [STRIPE_EVENTS.SUBSCRIPTION_DELETED]: {
    // events.list retains only ~30 days, so cancellations are not replayable;
    // fine for notification-only. If cancellation ever mutates state again,
    // switch to a durable source (subscriptions.list, no ended_at range filter).
    fetch: (from, to) =>
      Array.fromAsync(
        stripe!.events.list({
          type: STRIPE_EVENTS.SUBSCRIPTION_DELETED,
          created: { gte: from, lt: to },
          limit: 100
        })
      )
  }
};

type WindowData = Record<string, StripeItem[]>;

class StripeProvider extends BaseProvider {
  private readonly writers: Record<string, StripeWriter>;
  private windowsCache = new Map<number, WindowData>();

  constructor(
    args: ConstructorParameters<typeof BaseProvider>[0] & {
      writers: Record<string, StripeWriter>;
    }
  ) {
    super(args);
    this.writers = args.writers;
  }

  private events(): { name: string; fn: string }[] {
    return (this.instance.config.sources ?? []).flatMap(
      source => source.events
    );
  }

  private async fetchWindow(from: number, to: number): Promise<WindowData> {
    if (!stripe) return {};

    const events = this.events();
    const items = await Promise.all(
      events.map(event => SOURCES[event.name].fetch(from, to))
    );
    return Object.fromEntries(events.map((event, i) => [event.name, items[i]]));
  }

  private async processWindow(data: WindowData): Promise<void> {
    for (const event of this.events()) {
      const writer = this.writers[event.fn];
      const items = data[event.name] ?? [];
      if (SOURCES[event.name].ordered) {
        items.sort((a, b) => a.created - b.created);
      }
      for (const item of items) {
        try {
          await writer(item);
        } catch (err) {
          console.error(`[stripe] indexer: ${event.fn} failed`, item.id, err);
        }
      }
    }
  }

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
      (await this.fetchWindow(
        blockNumber * WINDOW,
        (blockNumber + 1) * WINDOW
      ));
    this.windowsCache.delete(blockNumber);

    await this.processWindow(data);
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
    const data = await this.fetchWindow(
      fromBlock * WINDOW,
      (toBlock + 1) * WINDOW
    );

    const windows = new Set<number>();
    for (const event of this.events()) {
      for (const item of data[event.name] ?? []) {
        const block = ~~(item.created / WINDOW);
        windows.add(block);
        let bucket = this.windowsCache.get(block);
        if (!bucket) {
          bucket = {};
          this.windowsCache.set(block, bucket);
        }
        (bucket[event.name] ??= []).push(item);
      }
    }

    return [...windows].map(blockNumber => ({
      blockNumber,
      contractAddress: 'stripe'
    }));
  }
}

export class StripeIndexer extends BaseIndexer {
  private writers: Record<string, StripeWriter>;

  constructor(writers: Record<string, StripeWriter> = createStripeWriters()) {
    super();
    this.writers = writers;
  }

  init(args: Parameters<BaseIndexer['init']>[0]): void {
    this.provider = new StripeProvider({ ...args, writers: this.writers });
  }

  getHandlers(): string[] {
    return Object.keys(this.writers);
  }
}
