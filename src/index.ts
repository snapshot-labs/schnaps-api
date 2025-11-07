import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import Checkpoint, { evm, LogLevel } from '@snapshot-labs/checkpoint';
import cors from 'cors';
import express from 'express';
import { createConfig } from './config';
import { startExpirationMonitor } from './expirationMonitor';
import overrides from './overrides.json';
import { sleep } from './utils';
import { createEvmWriters } from './writers';

const PRODUCTION_INDEXER_DELAY = 60 * 1000;
const dir = __dirname.endsWith('dist/src') ? '../' : '';
const schemaFile = path.join(__dirname, `${dir}../src/schema.gql`);
const schema = fs.readFileSync(schemaFile, 'utf8');

if (process.env.CA_CERT) {
  process.env.CA_CERT = process.env.CA_CERT.replace(/\\n/g, '\n');
}

const network = process.env.INDEX_TESTNET ? 'sep' : 'eth';
const config = createConfig(network);

const checkpoint = new Checkpoint(schema, {
  logLevel: LogLevel.Info,
  prettifyLogs: true,
  overridesConfig: overrides
});

const indexer = new evm.EvmIndexer(createEvmWriters(network));
checkpoint.addIndexer(network, config, indexer);

async function run() {
  if (process.env.NODE_ENV === 'production') {
    console.log(
      'Delaying indexer to prevent multiple processes indexing at the same time.'
    );
    await sleep(PRODUCTION_INDEXER_DELAY);
  }

  await checkpoint.resetMetadata();
  await checkpoint.reset();
  checkpoint.start();
  startExpirationMonitor(checkpoint, config);
}

run();

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ limit: '4mb', extended: false }));
app.use(cors({ maxAge: 86400 }));
app.use('/', checkpoint.graphql);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening at http://localhost:${PORT}`));
