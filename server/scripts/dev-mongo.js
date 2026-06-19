// Dev-only persistent MongoDB for local work without a system install.
// Boots mongodb-memory-server on 127.0.0.1:27017 with an on-disk dbPath
// (server/.mongo-data) so data survives restarts. Keep this process running
// while developing; the NestJS API connects to it via MONGO_URI in .env.
const path = require('path');
const fs = require('fs');
const { MongoMemoryServer } = require('mongodb-memory-server');

(async () => {
  const dbPath = path.resolve(__dirname, '..', '.mongo-data');
  fs.mkdirSync(dbPath, { recursive: true });
  const mongod = await MongoMemoryServer.create({
    instance: { ip: '127.0.0.1', port: 27017, dbPath, storageEngine: 'wiredTiger' },
    binary: { version: '8.2.6' }, // matches the cached binary → no download
  });
  console.log('MEMORY_MONGO_READY ' + mongod.getUri());
  const stop = async () => { try { await mongod.stop({ doCleanup: false }); } catch {} process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  setInterval(() => {}, 1 << 30); // keep the event loop alive
})().catch((e) => {
  console.error('MONGO_FAIL ' + (e && e.message ? e.message : e));
  process.exit(1);
});
