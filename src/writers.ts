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
    const amount = (Number(event.args.amount.toString()) / 1e6).toFixed(2); // Transforms 1990000 to 1.99
    const barcode = event.args.barcode;

    const chain = indexerName; // The indexer name corresponds to the chain name
    let tokenSymbol = getTokenSymbol(tokenAddress, chain);

    if (!tokenSymbol) {
      // TODO log missing token
      tokenSymbol = tokenAddress;
    }

    const payment = new Payment(`${tx.hash}`, indexerName);
    payment.sender = sender;
    payment.token_address = tokenAddress;
    payment.token_symbol = tokenSymbol;
    payment.amount = amount;

    payment.barcode = barcode;
    const ipfsData = await getJSON(barcode);

    payment.block = block.number;
    payment.type = ipfsData.type;
    payment.timestamp = block.timestamp;

    await payment.save();
  };

  return {
    handlePaymentReceived
  };
}
