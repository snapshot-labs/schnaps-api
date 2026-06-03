import { evm } from '@snapshot-labs/checkpoint';
import SchnapsAbi from './abis/Schnaps';
import { TURBO_PRICE_USD } from './config';
import { notifyPayment } from './discord';
import tokens from './payment_tokens.json';
import { getJSON } from './utils';
import { Payment, Space } from '../.checkpoint/models';

const MILLISECONDS = 1000;
const DECIMALS = 1e6; // USDC and USDT both have 6 decimals

const TURBO_MONTHLY_PRICE = TURBO_PRICE_USD.monthly * DECIMALS;
const TURBO_YEARLY_PRICE = TURBO_PRICE_USD.yearly * DECIMALS;

const DAYS_PER_YEAR = (365 * 3 + 366) / 4; // Accounting for leap years, which happens even four year (this is technically incorrect due to leap seconds but it's good enough for this purpose)
const YEARLY_PRICE_PER_DAY = TURBO_YEARLY_PRICE / DAYS_PER_YEAR;
const YEARLY_PRICE_PER_SECOND = YEARLY_PRICE_PER_DAY / (24 * 60 * 60); // 24 hours * 60 minutes * 60 seconds

const DAYS_PER_MONTH = (365 * 3 + 366) / 48; // Accounting for leap years, which happens even four year (this is technically incorrect due to leap seconds but it's good enough for this purpose)
const MONTHLY_PRICE_PER_DAY = TURBO_MONTHLY_PRICE / DAYS_PER_MONTH;
const MONTHLY_PRICE_PER_SECOND = MONTHLY_PRICE_PER_DAY / (24 * 60 * 60); // 24 hours * 60 minutes * 60 seconds

const ADMIN_ADDRESS = (
  process.env.ADMIN_ADDRESS || '0x8C28Cf33d9Fd3D0293f963b1cd27e3FF422B425c'
).toLowerCase();

const MIGRATED_TURBO_SPACES = {
  's:mimo.eth': 's:parallel-protocol.eth',
  's:aventus.eth': 's:aventus-gov.eth',
  's:aave.eth': 's:aavedao.eth'
};

function getTokenSymbol(tokenAddress: string, chain: string) {
  return tokens[chain][tokenAddress];
}

// Computes the new expiration date from a payment amount.
// Pure helper, no entity coupling — both the on-chain writer and the Stripe
// indexer call this with primitives.
// - Returns the current expiration unchanged if the amount is below one month
// - If the user has paid for more than a year, extends by the number of years paid
//   plus a per-second surplus at YEARLY_PRICE_PER_SECOND
// - Otherwise extends by the number of months paid plus a per-second surplus
//   at MONTHLY_PRICE_PER_SECOND
export function computeExpirationFromAmount(
  amountRaw: bigint,
  currentExpiration: number,
  timestamp: number
): Date {
  if (amountRaw < TURBO_MONTHLY_PRICE) {
    if (currentExpiration) {
      return new Date(currentExpiration * MILLISECONDS);
    }
    return new Date(0);
  }

  const baseTimestamp = Math.max(currentExpiration, timestamp);
  const expirationDate = new Date(baseTimestamp * MILLISECONDS);

  if (amountRaw >= TURBO_YEARLY_PRICE) {
    const years = Number(amountRaw) / TURBO_YEARLY_PRICE;
    expirationDate.setFullYear(expirationDate.getFullYear() + years);

    const surplus = Number(amountRaw) % TURBO_YEARLY_PRICE;
    const surplusSeconds = surplus / YEARLY_PRICE_PER_SECOND;
    expirationDate.setSeconds(expirationDate.getSeconds() + surplusSeconds);
  } else {
    const months = Number(amountRaw) / TURBO_MONTHLY_PRICE;
    expirationDate.setMonth(expirationDate.getMonth() + months);

    const surplus = Number(amountRaw) % TURBO_MONTHLY_PRICE;
    const surplusSeconds = surplus / MONTHLY_PRICE_PER_SECOND;
    expirationDate.setSeconds(expirationDate.getSeconds() + surplusSeconds);
  }

  return expirationDate;
}

function computeExpiration(
  space: Space,
  payment: Payment,
  metadata: any,
  blockTimestamp: number
): Date {
  // If the payment is from the admin address, simply return the expiration date from the metadata
  if (
    payment.sender.toLowerCase() === ADMIN_ADDRESS &&
    payment.amount_raw == 0n
  ) {
    const date = new Date(metadata.params.expiration * MILLISECONDS);
    return isNaN(date.getTime()) ? new Date(0) : date;
  }

  return computeExpirationFromAmount(
    payment.amount_raw,
    space.turbo_expiration,
    blockTimestamp
  );
}

export function createEvmWriters(indexerName: string) {
  const handlePaymentReceived: evm.Writer<
    typeof SchnapsAbi,
    'PaymentReceived'
  > = async ({ block, txId, event }) => {
    if (!block || !event) return;

    // Prevent indexing test batch txs
    if ([24898810, 24899177, 24899186].includes(Number(block.number))) return;

    const { sender, token, amount, barcode } = event.args;
    const tokenAddress = token.toLowerCase();
    const amountRaw = BigInt(amount);
    const amountDecimal = Number(amountRaw) / DECIMALS;

    const tokenSymbol = getTokenSymbol(tokenAddress, indexerName) || '';

    const payment = new Payment(txId, indexerName);
    payment.sender = sender;
    payment.token_address = tokenAddress;
    payment.token_symbol = tokenSymbol;
    payment.amount_raw = amountRaw;
    payment.amount_decimal = amountDecimal.toString();

    payment.barcode = barcode;
    let metadata;
    try {
      metadata = await getJSON(barcode);
    } catch (err) {
      console.error('Failed to fetch metadata for barcode:', err);
      return;
    }
    if (!metadata?.params?.space) return;

    metadata.params.space =
      MIGRATED_TURBO_SPACES[metadata.params.space] ?? metadata.params.space;
    console.log('Payment received for space', metadata.params.space);

    payment.block = Number(block.number);
    payment.timestamp = Number(block.timestamp);
    payment.type = metadata.type;

    if (metadata.ref && typeof metadata.ref === 'string')
      payment.ref = metadata.ref;

    if (payment.type === 'turbo') payment.space = metadata.params.space;

    await payment.save();

    // Try to get the space entity
    let space = await Space.loadEntity(metadata.params.space, indexerName);
    // If it doesn't exist, create it
    if (!space) {
      space = new Space(metadata.params.space, indexerName);
    }

    const expirationDate = computeExpiration(
      space,
      payment,
      metadata,
      Number(block.timestamp)
    );

    space.turbo_expiration = expirationDate.getTime() / MILLISECONDS; // Divide by 1000 to convert to seconds
    space.turbo_expiration_date = expirationDate.toDateString();

    await space.save();

    notifyPayment(payment, space, block, txId);
  };

  return {
    handlePaymentReceived
  };
}
