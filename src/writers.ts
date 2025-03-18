import { evm } from '@snapshot-labs/checkpoint';
import { Payment, Space } from '../.checkpoint/models';
import { getJSON } from './utils';
import tokens from './payment_tokens.json';

const TURBO_MONTHLY_PRICE = BigInt(0.1 * 1e6); // 10 USDC
const TURBO_YEARLY_PRICE = BigInt(0.8 * 1e6); // 100 USDC

const SNAPSHOT_ADDRESS = '0x1234';

function getTokenSymbol(tokenAddress: string, chain: string) {
  return tokens[chain][tokenAddress];
}

function computeExpiration(space: Space, payment: Payment, metadata: any, blockTimestamp: number) {
  // If the payment is from the snapshot address, simply return the expiration date from the metadata
  if (payment.sender.toLowerCase() === SNAPSHOT_ADDRESS) {
    return new Date(metadata.params.expiration * 1000);
  }

  const currentexpirationTimestamp = space.turbo_expiration_timestamp
    ? space.turbo_expiration_timestamp
    : blockTimestamp;
  const expirationDate = new Date(currentexpirationTimestamp * 1000); // Multiply by 1000 to convert to milliseconds

  if (payment.amount_raw < TURBO_MONTHLY_PRICE) {
    // Return early because the payment is not enough to extend the expiration
    return null;
  }

  const months = Number((payment.amount_raw % TURBO_YEARLY_PRICE) / TURBO_MONTHLY_PRICE);
  const years = Number(payment.amount_raw / TURBO_YEARLY_PRICE);

  expirationDate.setMonth(expirationDate.getMonth() + months);
  expirationDate.setFullYear(expirationDate.getFullYear() + years);

  return expirationDate;
}

export function createEvmWriters(indexerName: string) {
  const handlePaymentReceived: evm.Writer = async ({ block, tx, event }) => {
    console.log('In handlePaymentReceived');
    if (!block || !event) return;

    const sender = event.args.sender;
    const tokenAddress = event.args.token.toLowerCase();
    const amountRaw = BigInt(event.args.amount);
    const amountDecimal = Number(amountRaw) / 1e6;
    const barcode = event.args.barcode;

    const tokenSymbol = getTokenSymbol(tokenAddress, indexerName) || '';

    const payment = new Payment(tx.hash, indexerName);
    payment.sender = sender;
    payment.token_address = tokenAddress;
    payment.token_symbol = tokenSymbol;
    payment.amount_raw = amountRaw;
    payment.amount_decimal = amountDecimal.toString();

    payment.barcode = barcode;
    const metadata = await getJSON(barcode);

    payment.block = block.number;
    payment.type = metadata.type;
    payment.beneficiary = payment.type === 'turbo' ? metadata.params.space : 'unknown';
    payment.timestamp = block.timestamp;

    await payment.save();

    // Try to get the space entity
    let space = await Space.loadEntity(metadata.params.space, indexerName);
    // If it doesn't exist, create it
    if (!space) {
      space = new Space(metadata.params.space, indexerName);
    }

    const expirationDate = computeExpiration(space, payment, block.timestamp, metadata);
    if (expirationDate !== null) {
      space.turbo_expiration_timestamp = expirationDate.getTime() / 1000; // Divide by 1000 to convert to seconds
      space.turbo_expiration_date = expirationDate.toDateString();
      await space.save();
    }
  };

  return {
    handlePaymentReceived
  };
}
