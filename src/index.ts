import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import Checkpoint, { evm, LogLevel } from '@snapshot-labs/checkpoint';
import { createConfig } from './config';
import { createEvmWriters } from './writers';

const dir = __dirname.endsWith('dist/src') ? '../' : '';
const schemaFile = path.join(__dirname, `${dir}../src/schema.gql`);
const schema = fs.readFileSync(schemaFile, 'utf8');

const sepoliaConfig = createConfig('sepolia');
const baseConfig = createConfig('base');

const sepoliaIndexer = new evm.EvmIndexer(createEvmWriters('sepolia'));
const baseIndexer = new evm.EvmIndexer(createEvmWriters('base'));

const checkpoint = new Checkpoint(schema, {
  logLevel: LogLevel.Info,
  prettifyLogs: true
});

checkpoint.addIndexer('sepolia', sepoliaConfig, sepoliaIndexer);
checkpoint.addIndexer('base', baseConfig, baseIndexer);

async function run() {
  await checkpoint.resetMetadata();
  await checkpoint.reset();
  await checkpoint.start();
}

run();

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ limit: '4mb', extended: false }));
app.use(cors({ maxAge: 86400 }));
app.use('/', checkpoint.graphql);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening at http://localhost:${PORT}`));
