import { evm } from '@snapshot-labs/checkpoint';
import { Payment } from '../.checkpoint/models';

export function createEvmWriters(indexerName: string) {
  const handlePaymentReceived: evm.Writer = async ({ block, tx, event }) => {
    console.log('In handlePaymentReceived');
    if (!block || !event) return;

    const sender = event.args.sender;
    const token = event.args.token;
    const amount = event.args.amount;
    const barcode = event.args.barcode;

    const payment = new Payment(`${sender}/${tx.hash}`, indexerName);
    payment.sender = sender;
    payment.token = token;
    payment.amount = amount;
    payment.barcode = barcode;
    payment.block = block.number;

    await payment.save();
  };

  return {
    handlePaymentReceived
  };
}
