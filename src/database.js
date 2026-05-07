const { createClient } = require("@libsql/client");

let client;

async function initDB() {
  client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  // DDL statements must be run separately from DML in libSQL batch
  await client.batch([
    {
      sql: `CREATE TABLE IF NOT EXISTS batches (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS sensor_readings (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        createdAt TEXT NOT NULL
      )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        createdAt TEXT NOT NULL
      )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
      args: [],
    },
  ], "write");

  // Insert default settings separately using parameterized query (safe)
  const defaultSettings = JSON.stringify({
    targetTemperature: parseFloat(process.env.DEFAULT_TARGET_TEMP) || 50,
    dryingTimeMinutes: parseFloat(process.env.DEFAULT_DRYING_TIME_MINUTES) || 120,
    dryerOn: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await client.execute({
    sql: `INSERT OR IGNORE INTO settings (key, value) VALUES ('main', ?)`,
    args: [defaultSettings],
  });

  console.log("Turso database initialized");
  return client;
}

function getDB() {
  if (!client) throw new Error("Database not initialized. Call initDB() first.");
  return client;
}

module.exports = { initDB, getDB };