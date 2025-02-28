import { evm } from '@snapshot-labs/checkpoint';
import { Payment } from '../.checkpoint/models';
import { readFileSync } from 'fs';
import { getJSON } from './utils';

const tokens = JSON.parse(readFileSync('./src/payment_tokens.json', 'utf8'));

function getTokenName(token: string, chain: string) {
  return tokens[chain][token.toLowerCase()];
}

export function createEvmWriters(indexerName: string) {
  const handlePaymentReceived: evm.Writer = async ({ block, tx, event }) => {
    console.log('In handlePaymentReceived');
    if (!block || !event) return;

    const sender = event.args.sender;
    const token = event.args.token;
    const amount = (Number(event.args.amount.toString()) / 1e6).toFixed(2); // Transforms 1990000 to 1.99
    const barcode = event.args.barcode;

    const chain = indexerName; // The indexer name corresponds to the chain name
    let tokenName = getTokenName(token, chain);

    if (!tokenName) {
      // TODO log missing token
      tokenName = token;
    }

    const payment = new Payment(`${tx.hash}`, indexerName);
    payment.sender = sender;
    payment.token = tokenName;
    payment.amount = amount;

    payment.barcode = barcode;
    const ipfsData = await getJSON(barcode);

    payment.block = block.number;
    payment.product = ipfsData.type;
    const paymentDate = new Date(block.timestamp * 1000);
    payment.date = paymentDate.toDateString();

    await payment.save();
  };

  return {
    handlePaymentReceived
  };
}
