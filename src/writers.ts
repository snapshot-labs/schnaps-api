import { evm } from '@snapshot-labs/checkpoint';
import { Payment, Space } from '../.checkpoint/models';
import { getJSON } from './utils';
import tokens from './payment_tokens.json';

const MILLISECONDS = 1000;
const DECIMALS = 1e6; // USDC and USDT both have 6 decimals

const TURBO_MONTHLY_PRICE = 600 * DECIMALS;
const TURBO_YEARLY_PRICE = 6000 * DECIMALS;

const DAYS_PER_YEAR = (365 * 3 + 366) / 4; // Accounting for leap years, which happens even four year (this is technically incorrect due to leap seconds but it's good enough for this purpose)
const YEARLY_PRICE_PER_DAY = TURBO_YEARLY_PRICE / DAYS_PER_YEAR;
const YEARLY_PRICE_PER_SECOND = YEARLY_PRICE_PER_DAY / (24 * 60 * 60); // 24 hours * 60 minutes * 60 seconds

const DAYS_PER_MONTH = (365 * 3 + 366) / 48; // Accounting for leap years, which happens even four year (this is technically incorrect due to leap seconds but it's good enough for this purpose)
const MONTHLY_PRICE_PER_DAY = TURBO_MONTHLY_PRICE / DAYS_PER_MONTH;
const MONTHLY_PRICE_PER_SECOND = MONTHLY_PRICE_PER_DAY / (24 * 60 * 60); // 24 hours * 60 minutes * 60 seconds

const ADMIN_ADDRESS = process.env.ADMIN_ADDRESS || '0x8C28Cf33d9Fd3D0293f963b1cd27e3FF422B425c';

function getTokenSymbol(tokenAddress: string, chain: string) {
  return tokens[chain][tokenAddress];
}

// Computes the time of expiration of a space based on the payment received.
// The logic is as follows:
// - Returns `null` if the payment is not enough to extend the by at least one month
// - If the user has paid for more than a year, the expiration date is extended by the number of years paid
//   - Then take the surplus and increase the expiration date based on the YEARLY_PRICE_PER_SECOND
// - If the user has paid for more than a month (but less than a year), the expiration date is extended by the number of months paid
//   - Then take the surplus and increase the expiration date based on the MONTHLY_PRICE_PER_SECOND
function computeExpiration(
  space: Space,
  payment: Payment,
  metadata: any,
  blockTimestamp: number
): Date {
  // If the payment is from the admin address, simply return the expiration date from the metadata
  if (payment.sender.toLowerCase() === ADMIN_ADDRESS) {
    return new Date(metadata.params.expiration * MILLISECONDS);
  }

  if (payment.amount_raw < TURBO_MONTHLY_PRICE) {
    // Return early because the payment is not enough to extend the expiration
    if (space.turbo_expiration) {
      // User already had an expiration date, leave it untouched.
      return new Date(space.turbo_expiration * 1000);
    } else {
      // User didn't have an expiration date, leave it to 0
      return new Date(0);
    }
  }

  // If the space already has an expiration date, use it as the current expiration date
  const currentExpirationTimestamp = Math.max(space.turbo_expiration, blockTimestamp);
  const expirationDate = new Date(currentExpirationTimestamp * MILLISECONDS); // Multiply by 1000 to convert to milliseconds

  const userPaidAtLeastAYear = payment.amount_raw >= TURBO_YEARLY_PRICE;
  if (userPaidAtLeastAYear) {
    const years = Number(payment.amount_raw) / TURBO_YEARLY_PRICE;
    expirationDate.setFullYear(expirationDate.getFullYear() + years);

    const surplus = Number(payment.amount_raw) % TURBO_YEARLY_PRICE;
    const surplusSeconds = surplus / YEARLY_PRICE_PER_SECOND;
    expirationDate.setSeconds(expirationDate.getSeconds() + surplusSeconds);
  } else if (payment.amount_raw >= TURBO_MONTHLY_PRICE) {
    const months = Number(payment.amount_raw) / TURBO_MONTHLY_PRICE;
    expirationDate.setMonth(expirationDate.getMonth() + months);

    const surplus = Number(payment.amount_raw) % TURBO_MONTHLY_PRICE;
    const surplusSeconds = surplus / MONTHLY_PRICE_PER_SECOND;
    expirationDate.setSeconds(expirationDate.getSeconds() + surplusSeconds);
  } else {
    console.log('error, unreachable code. Payment is not enough to extend the expiration');
  }

  return expirationDate;
}

export function createEvmWriters(indexerName: string) {
  const handlePaymentReceived: evm.Writer = async ({ block, tx, event }) => {
    if (!block || !event) return;

    const sender = event.args.sender;
    const tokenAddress = event.args.token.toLowerCase();
    const amountRaw = BigInt(event.args.amount);
    const amountDecimal = Number(amountRaw) / DECIMALS;
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

    if (payment.type === 'turbo') {
      payment.space = metadata.params.space;
    }

    payment.timestamp = block.timestamp;

    await payment.save();

    // Try to get the space entity
    let space = await Space.loadEntity(metadata.params.space, indexerName);
    // If it doesn't exist, create it
    if (!space) {
      space = new Space(metadata.params.space, indexerName);
    }

    const expirationDate = computeExpiration(space, payment, metadata, block.timestamp);

    space.turbo_expiration = expirationDate.getTime() / MILLISECONDS; // Divide by 1000 to convert to seconds
    space.turbo_expiration_date = expirationDate.toDateString();

    await space.save();
  };

  return {
    handlePaymentReceived
  };
}
