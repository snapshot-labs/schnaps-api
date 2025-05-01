import { Payment, Space } from '../.checkpoint/models';

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const INDEX_TESTNET = process.env.INDEX_TESTNET;

export async function notifyPayment(
  payment: Payment,
  space: Space,
  block: any,
  tx: any
): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) return;

  const now = ~~(Date.now() / 1e3);
  const recentThreshold = now - 60 * 30;

  if (block.timestamp < recentThreshold) return;

  const content = `**New payment of ${payment.amount_decimal} ${payment.token_symbol} for [${
    payment.space
  }](https://${INDEX_TESTNET ? 'testnet.' : ''}snapshot.box/#/s${INDEX_TESTNET ? '-tn' : ''}:${
    payment.space
  })**\nFrom [${payment.sender}](https://${INDEX_TESTNET ? 'sepolia.' : ''}etherscan.io/address/${
    payment.sender
  }), expiration : ${space.turbo_expiration_date}\n<https://${
    INDEX_TESTNET ? 'sepolia.' : ''
  }etherscan.io/tx/${tx.hash}>`;

  await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  });

  return;
}
