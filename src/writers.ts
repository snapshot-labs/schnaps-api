import { evm } from '@snapshot-labs/checkpoint';
import { Payment } from '../.checkpoint/models';
import { getJSON } from './utils';
import tokens from './payment_tokens.json';

function getTokenSymbol(tokenAddress: string, chain: string) {
  return tokens[chain][tokenAddress];
}

export function createEvmWriters(indexerName: string) {
  const handlePaymentReceived: evm.Writer = async ({ block, tx, event }) => {
    console.log('In handlePaymentReceived');
    if (!block || !event) return;

    const sender = event.args.sender;
    const tokenAddress = event.args.token.toLowerCase();
    const amountRaw = BigInt(event.args.amount);
    const amountDecimal = amountRaw / BigInt(1e6); // Transforms 1990000 to 1.99. We used 1e6 because USDC and USDT have 6 decimals.
    const barcode = event.args.barcode;

    const tokenSymbol = getTokenSymbol(tokenAddress, indexerName) || '';

    const payment = new Payment(`${tx.hash}`, indexerName);
    payment.sender = sender;
    payment.token_address = tokenAddress;
    payment.token_symbol = tokenSymbol;
    payment.amount_raw = amountRaw;
    console.log('amountDecimal', amountDecimal);
    payment.amount_decimal = amountDecimal.toString();

    payment.barcode = barcode;
    const metadata = await getJSON(barcode);

    payment.block = block.number;
    payment.type = metadata.type;
    payment.beneficiary = payment.type === 'turbo' ? metadata.params.space : 'unknown';
    payment.timestamp = block.timestamp;

    await payment.save();
  };

  return {
    handlePaymentReceived
  };
}
