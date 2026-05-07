const { v4: uuidv4 } = require("uuid");
const { getDB } = require("../database");

const ALERT_TYPES = {
  DRYING_COMPLETE: "DRYING_COMPLETE",
  HIGH_TEMPERATURE: "HIGH_TEMPERATURE",
  LOW_HUMIDITY: "LOW_HUMIDITY",
  HIGH_HUMIDITY: "HIGH_HUMIDITY",
  DRYER_STARTED: "DRYER_STARTED",
  DRYER_STOPPED: "DRYER_STOPPED",
  BATCH_STARTED: "BATCH_STARTED",
  SENSOR_ERROR: "SENSOR_ERROR",
  TARGET_TEMP_REACHED: "TARGET_TEMP_REACHED",
};

const ALERT_SEVERITY = {
  INFO: "info",
  WARNING: "warning",
  CRITICAL: "critical",
};

let io = null;

function setSocketIO(socketInstance) {
  io = socketInstance;
}

async function createAlert(type, message, severity = ALERT_SEVERITY.INFO, batchId = null, meta = {}) {
  const client = getDB();

  const alert = {
    id: uuidv4(),
    type,
    message,
    severity,
    batchId,
    meta,
    read: false,
    createdAt: new Date().toISOString(),
  };

  await client.execute({
    sql: `INSERT INTO alerts (id, data, createdAt) VALUES (?, ?, ?)`,
    args: [alert.id, JSON.stringify(alert), alert.createdAt],
  });

  await client.execute({
    sql: `
      DELETE FROM alerts
      WHERE id IN (
        SELECT id FROM alerts
        ORDER BY createdAt DESC
        LIMIT -1 OFFSET 200
      )
    `,
    args: [],
  });

  if (io) {
    io.emit("alert", alert);
  }

  console.log(`[${severity.toUpperCase()}] ${type}: ${message}`);
  return alert;
}

async function checkThresholds(sensorData, activeBatchId) {
  const { temperature, humidity } = sensorData;
  const maxTemp = parseFloat(process.env.MAX_TEMPERATURE) || 75;
  const minHumidity = parseFloat(process.env.MIN_HUMIDITY) || 10;
  const maxHumidity = parseFloat(process.env.MAX_HUMIDITY) || 95;

  if (temperature !== undefined && temperature > maxTemp) {
    await createAlert(
      ALERT_TYPES.HIGH_TEMPERATURE,
      `Temperature critically high: ${temperature}°C (max ${maxTemp}°C)`,
      ALERT_SEVERITY.CRITICAL,
      activeBatchId,
      { temperature, threshold: maxTemp }
    );
  }

  if (humidity !== undefined && humidity < minHumidity) {
    await createAlert(
      ALERT_TYPES.LOW_HUMIDITY,
      `Humidity dangerously low: ${humidity}% (min ${minHumidity}%)`,
      ALERT_SEVERITY.WARNING,
      activeBatchId,
      { humidity, threshold: minHumidity }
    );
  }

  if (humidity !== undefined && humidity > maxHumidity) {
    await createAlert(
      ALERT_TYPES.HIGH_HUMIDITY,
      `Humidity very high: ${humidity}% (max ${maxHumidity}%)`,
      ALERT_SEVERITY.WARNING,
      activeBatchId,
      { humidity, threshold: maxHumidity }
    );
  }
}

module.exports = {
  createAlert,
  checkThresholds,
  setSocketIO,
  ALERT_TYPES,
  ALERT_SEVERITY,
};