const { getDB } = require("../database");
const { createAlert, ALERT_TYPES, ALERT_SEVERITY } = require("../utils/alertManager");

async function getDryerStatus(req, res) {
  try {
    const db = getDB();

    const settingsResult = await db.execute("SELECT value FROM settings WHERE key = 'main'");
    const settings = JSON.parse(settingsResult.rows[0].value);

    const activeResult = await db.execute(
      "SELECT data FROM batches WHERE json_extract(data, '$.status') = 'drying' LIMIT 1"
    );
    const activeBatch = activeResult.rows.length ? JSON.parse(activeResult.rows[0].data) : null;

    const latestResult = await db.execute(
      "SELECT data FROM sensor_readings ORDER BY createdAt DESC LIMIT 1"
    );
    const latestReading = latestResult.rows.length ? JSON.parse(latestResult.rows[0].data) : null;

    res.json({
      success: true,
      data: {
        dryerOn: settings.dryerOn,
        dryingStatus: activeBatch ? "drying" : "idle",
        targetTemperature: settings.targetTemperature,
        dryingTimeMinutes: settings.dryingTimeMinutes,
        activeBatch: activeBatch ? {
          id: activeBatch.id,
          batchNumber: activeBatch.batchNumber,
          vegetableName: activeBatch.vegetableName,
          startTime: activeBatch.startTime,
          elapsedMinutes: Math.round((Date.now() - new Date(activeBatch.startTime)) / 60000),
          remainingMinutes: Math.max(0, activeBatch.dryingTimeMinutes - Math.round((Date.now() - new Date(activeBatch.startTime)) / 60000)),
          targetTemperature: activeBatch.targetTemperature,
          dryingTimeMinutes: activeBatch.dryingTimeMinutes,
        } : null,
        latestSensor: latestReading ? {
          temperature: latestReading.temperature,
          humidity: latestReading.humidity,
          weight: latestReading.weight,
          timestamp: latestReading.timestamp,
        } : null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function turnDryerOn(req, res) {
  try {
    const db = getDB();
    const settingsResult = await db.execute("SELECT value FROM settings WHERE key = 'main'");
    const settings = JSON.parse(settingsResult.rows[0].value);

    if (settings.dryerOn)
      return res.json({ success: true, message: "Dryer is already on", data: { dryerOn: true } });

    const updated = { ...settings, dryerOn: true, updatedAt: new Date().toISOString() };
    await db.execute({ sql: "UPDATE settings SET value = ? WHERE key = 'main'", args: [JSON.stringify(updated)] });

    await createAlert(ALERT_TYPES.DRYER_STARTED, "Dryer turned ON manually", ALERT_SEVERITY.INFO);

    const io = req.app.get("io");
    if (io) io.emit("dryerStatus", { dryerOn: true });

    res.json({ success: true, message: "Dryer turned on", data: { dryerOn: true } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function turnDryerOff(req, res) {
  try {
    const db = getDB();
    const settingsResult = await db.execute("SELECT value FROM settings WHERE key = 'main'");
    const settings = JSON.parse(settingsResult.rows[0].value);

    if (!settings.dryerOn)
      return res.json({ success: true, message: "Dryer is already off", data: { dryerOn: false } });

    const updated = { ...settings, dryerOn: false, updatedAt: new Date().toISOString() };
    await db.execute({ sql: "UPDATE settings SET value = ? WHERE key = 'main'", args: [JSON.stringify(updated)] });

    await createAlert(ALERT_TYPES.DRYER_STOPPED, "Dryer turned OFF manually", ALERT_SEVERITY.WARNING);

    const io = req.app.get("io");
    if (io) io.emit("dryerStatus", { dryerOn: false });

    res.json({ success: true, message: "Dryer turned off", data: { dryerOn: false } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getESP32Command(req, res) {
  try {
    const db = getDB();
    const settingsResult = await db.execute("SELECT value FROM settings WHERE key = 'main'");
    const settings = JSON.parse(settingsResult.rows[0].value);

    const activeResult = await db.execute(
      "SELECT data FROM batches WHERE json_extract(data, '$.status') = 'drying' LIMIT 1"
    );
    const activeBatch = activeResult.rows.length ? JSON.parse(activeResult.rows[0].data) : null;

    res.json({
      success: true,
      command: {
        dryerOn: settings.dryerOn,
        targetTemperature: activeBatch ? activeBatch.targetTemperature : settings.targetTemperature,
        dryingTimeMinutes: activeBatch ? activeBatch.dryingTimeMinutes : settings.dryingTimeMinutes,
        activeBatchId: activeBatch?.id || null,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateSettings(req, res) {
  try {
    const db = getDB();
    const { targetTemperature, dryingTimeMinutes } = req.body;

    const settingsResult = await db.execute("SELECT value FROM settings WHERE key = 'main'");
    const settings = JSON.parse(settingsResult.rows[0].value);

    if (targetTemperature !== undefined) {
      const temp = parseFloat(targetTemperature);
      if (isNaN(temp) || temp < 20 || temp > 90)
        return res.status(400).json({ success: false, message: "targetTemperature must be between 20 and 90°C" });
      settings.targetTemperature = temp;
    }

    if (dryingTimeMinutes !== undefined) {
      const mins = parseInt(dryingTimeMinutes);
      if (isNaN(mins) || mins < 1 || mins > 2880)
        return res.status(400).json({ success: false, message: "dryingTimeMinutes must be between 1 and 2880" });
      settings.dryingTimeMinutes = mins;
    }

    settings.updatedAt = new Date().toISOString();
    await db.execute({ sql: "UPDATE settings SET value = ? WHERE key = 'main'", args: [JSON.stringify(settings)] });

  
    const activeResult = await db.execute(
      "SELECT data FROM batches WHERE json_extract(data, '$.status') = 'drying' LIMIT 1"
    );
    if (activeResult.rows.length) {
      const activeBatch = JSON.parse(activeResult.rows[0].data);
      if (targetTemperature !== undefined) activeBatch.targetTemperature = settings.targetTemperature;
      if (dryingTimeMinutes !== undefined) activeBatch.dryingTimeMinutes = settings.dryingTimeMinutes;
      await db.execute({
        sql: "UPDATE batches SET data = ?, updatedAt = ? WHERE id = ?",
        args: [JSON.stringify(activeBatch), settings.updatedAt, activeBatch.id],
      });
    }

    const io = req.app.get("io");
    if (io) io.emit("settingsUpdated", settings);

    res.json({ success: true, data: settings, message: "Settings updated" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getDryerStatus, turnDryerOn, turnDryerOff, getESP32Command, updateSettings };