const { v4: uuidv4 } = require("uuid");
const { getDB } = require("../database");
const { checkThresholds, createAlert, ALERT_TYPES, ALERT_SEVERITY } = require("../utils/alertManager");

const MAX_READINGS_IN_DB = 10000;

async function receiveSensorData(req, res) {
  try {
    const db = getDB();
    const { temperature, humidity, weight } = req.body;

    if (temperature === undefined && humidity === undefined && weight === undefined)
      return res.status(400).json({ success: false, message: "At least one of temperature, humidity, or weight is required" });

    const activeResult = await db.execute(
      "SELECT data FROM batches WHERE json_extract(data, '$.status') = 'drying' LIMIT 1"
    );
    const activeBatch = activeResult.rows.length ? JSON.parse(activeResult.rows[0].data) : null;

    const now = new Date().toISOString();
    const reading = {
      id: uuidv4(),
      batchId: activeBatch?.id || null,
      temperature: temperature !== undefined ? parseFloat(temperature) : null,
      humidity: humidity !== undefined ? parseFloat(humidity) : null,
      weight: weight !== undefined ? parseFloat(weight) : null,
      timestamp: now,
    };

    await db.execute({
      sql: "INSERT INTO sensor_readings (id, data, createdAt) VALUES (?, ?, ?)",
      args: [reading.id, JSON.stringify(reading), now],
    });

    const countResult = await db.execute("SELECT COUNT(*) as count FROM sensor_readings");
    if (countResult.rows[0].count > MAX_READINGS_IN_DB) {
      await db.execute({
        sql: "DELETE FROM sensor_readings WHERE id IN (SELECT id FROM sensor_readings ORDER BY createdAt ASC LIMIT ?)",
        args: [countResult.rows[0].count - MAX_READINGS_IN_DB],
      });
    }

    await checkThresholds({ temperature, humidity }, activeBatch?.id);

    if (activeBatch) {
      const elapsed = (Date.now() - new Date(activeBatch.startTime)) / 60000;
      if (elapsed >= activeBatch.dryingTimeMinutes) {
        await createAlert(
          ALERT_TYPES.DRYING_COMPLETE,
          `Batch #${activeBatch.batchNumber}: Target drying time of ${activeBatch.dryingTimeMinutes} min reached!`,
          ALERT_SEVERITY.INFO,
          activeBatch.id
        );
      }

      if (temperature !== undefined && parseFloat(temperature) >= activeBatch.targetTemperature && !activeBatch._tempAlerted) {
        const updatedBatch = { ...activeBatch, _tempAlerted: true };
        await db.execute({
          sql: "UPDATE batches SET data = ?, updatedAt = ? WHERE id = ?",
          args: [JSON.stringify(updatedBatch), now, activeBatch.id],
        });
        await createAlert(
          ALERT_TYPES.TARGET_TEMP_REACHED,
          `Batch #${activeBatch.batchNumber}: Target temperature of ${activeBatch.targetTemperature}°C reached`,
          ALERT_SEVERITY.INFO,
          activeBatch.id,
          { temperature }
        );
      }
    }

    const settingsResult = await db.execute("SELECT value FROM settings WHERE key = 'main'");
    const settings = JSON.parse(settingsResult.rows[0].value);

    const io = req.app.get("io");
    if (io) {
      io.emit("sensorUpdate", {
        ...reading,
        dryerOn: settings.dryerOn,
        activeBatchId: activeBatch?.id || null,
        dryingStatus: activeBatch ? "drying" : "idle",
      });
    }

    res.status(201).json({ success: true, data: reading, message: "Sensor data recorded" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getLatestReading(req, res) {
  try {
    const db = getDB();

    const readingResult = await db.execute(
      "SELECT data FROM sensor_readings ORDER BY createdAt DESC LIMIT 1"
    );
    const latest = readingResult.rows.length ? JSON.parse(readingResult.rows[0].data) : null;

    const activeResult = await db.execute(
      "SELECT data FROM batches WHERE json_extract(data, '$.status') = 'drying' LIMIT 1"
    );
    const activeBatch = activeResult.rows.length ? JSON.parse(activeResult.rows[0].data) : null;

    const settingsResult = await db.execute("SELECT value FROM settings WHERE key = 'main'");
    const settings = JSON.parse(settingsResult.rows[0].value);

    res.json({
      success: true,
      data: {
        ...latest,
        dryerOn: settings.dryerOn,
        dryingStatus: activeBatch ? "drying" : "idle",
        activeBatch: activeBatch ? {
          id: activeBatch.id,
          batchNumber: activeBatch.batchNumber,
          vegetableName: activeBatch.vegetableName,
          startTime: activeBatch.startTime,
          targetTemperature: activeBatch.targetTemperature,
          dryingTimeMinutes: activeBatch.dryingTimeMinutes,
          elapsedMinutes: Math.round((Date.now() - new Date(activeBatch.startTime)) / 60000),
        } : null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getSensorHistory(req, res) {
  try {
    const db = getDB();
    const { batchId, type, from, to, limit = 500 } = req.query;

    let sql = "SELECT data FROM sensor_readings WHERE 1=1";
    const args = [];

    if (batchId) {
      sql += " AND json_extract(data, '$.batchId') = ?";
      args.push(batchId);
    }
    if (from) {
      sql += " AND createdAt >= ?";
      args.push(new Date(from).toISOString());
    }
    if (to) {
      sql += " AND createdAt <= ?";
      args.push(new Date(to).toISOString());
    }

    sql += " ORDER BY createdAt DESC LIMIT ?";
    args.push(parseInt(limit));

    const result = await db.execute({ sql, args });
    const readings = result.rows.map((r) => JSON.parse(r.data));

    if (type === "temperature")
      return res.json({ success: true, data: readings.filter((r) => r.temperature !== null).map((r) => ({ x: r.timestamp, y: r.temperature, id: r.id })) });

    if (type === "humidity")
      return res.json({ success: true, data: readings.filter((r) => r.humidity !== null).map((r) => ({ x: r.timestamp, y: r.humidity, id: r.id })) });

    if (type === "weight")
      return res.json({ success: true, data: readings.filter((r) => r.weight !== null).map((r) => ({ x: r.timestamp, y: r.weight, id: r.id })) });

    res.json({
      success: true,
      data: {
        temperature: readings.filter((r) => r.temperature !== null).map((r) => ({ x: r.timestamp, y: r.temperature })),
        humidity: readings.filter((r) => r.humidity !== null).map((r) => ({ x: r.timestamp, y: r.humidity })),
        weight: readings.filter((r) => r.weight !== null).map((r) => ({ x: r.timestamp, y: r.weight })),
      },
      count: readings.length,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { receiveSensorData, getLatestReading, getSensorHistory };