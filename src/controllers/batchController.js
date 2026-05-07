const { v4: uuidv4 } = require("uuid");
const { getDB } = require("../database");
const { createAlert, ALERT_TYPES, ALERT_SEVERITY } = require("../utils/alertManager");

async function getAllBatches(req, res) {
  try {
    const db = getDB();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const totalResult = await db.execute("SELECT COUNT(*) as count FROM batches");
    const total = totalResult.rows[0].count;

    const result = await db.execute({
      sql: "SELECT data FROM batches ORDER BY createdAt DESC LIMIT ? OFFSET ?",
      args: [limit, offset],
    });

    const batches = result.rows.map((r) => JSON.parse(r.data));

    res.json({
      success: true,
      data: batches,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getBatchById(req, res) {
  try {
    const db = getDB();
    const result = await db.execute({
      sql: "SELECT data FROM batches WHERE id = ?",
      args: [req.params.id],
    });

    if (!result.rows.length)
      return res.status(404).json({ success: false, message: "Batch not found" });

    const batch = JSON.parse(result.rows[0].data);

    const readingsResult = await db.execute({
      sql: "SELECT data FROM sensor_readings WHERE json_extract(data, '$.batchId') = ?",
      args: [batch.id],
    });
    const readings = readingsResult.rows.map((r) => JSON.parse(r.data));

    res.json({ success: true, data: { ...batch, readings } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getActiveBatch(req, res) {
  try {
    const db = getDB();
    const result = await db.execute(
      "SELECT data FROM batches WHERE json_extract(data, '$.status') = 'drying' LIMIT 1"
    );
    const activeBatch = result.rows.length ? JSON.parse(result.rows[0].data) : null;
    res.json({ success: true, data: activeBatch });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function startBatch(req, res) {
  try {
    const db = getDB();

    const activeResult = await db.execute(
      "SELECT data FROM batches WHERE json_extract(data, '$.status') = 'drying' LIMIT 1"
    );
    if (activeResult.rows.length) {
      const activeBatch = JSON.parse(activeResult.rows[0].data);
      return res.status(409).json({
        success: false,
        message: "A batch is already running. Complete it before starting a new one.",
        data: activeBatch,
      });
    }

    const { vegetableName = "Unknown", initialWeight, notes = "", targetTemperature, dryingTimeMinutes } = req.body;

    if (!initialWeight || isNaN(parseFloat(initialWeight))) {
      return res.status(400).json({ success: false, message: "initialWeight is required and must be a number" });
    }

    const settingsResult = await db.execute("SELECT value FROM settings WHERE key = 'main'");
    const settings = JSON.parse(settingsResult.rows[0].value);

    const countResult = await db.execute("SELECT COUNT(*) as count FROM batches");
    const batchNumber = countResult.rows[0].count + 1;

    const now = new Date().toISOString();
    const batch = {
      id: uuidv4(),
      batchNumber,
      vegetableName,
      initialWeight: parseFloat(initialWeight),
      finalWeight: null,
      weightLoss: null,
      weightLossPercent: null,
      status: "drying",
      targetTemperature: targetTemperature ? parseFloat(targetTemperature) : settings.targetTemperature,
      dryingTimeMinutes: dryingTimeMinutes ? parseInt(dryingTimeMinutes) : settings.dryingTimeMinutes,
      notes,
      startTime: now,
      endTime: null,
      durationMinutes: null,
      createdAt: now,
    };

    await db.execute({
      sql: "INSERT INTO batches (id, data, createdAt, updatedAt) VALUES (?, ?, ?, ?)",
      args: [batch.id, JSON.stringify(batch), now, now],
    });

    const updatedSettings = {
      ...settings,
      dryerOn: true,
      updatedAt: now,
      ...(targetTemperature && { targetTemperature: batch.targetTemperature }),
      ...(dryingTimeMinutes && { dryingTimeMinutes: batch.dryingTimeMinutes }),
    };
    await db.execute({
      sql: "UPDATE settings SET value = ? WHERE key = 'main'",
      args: [JSON.stringify(updatedSettings)],
    });

    await createAlert(
      ALERT_TYPES.BATCH_STARTED,
      `Batch #${batch.batchNumber} started — drying ${vegetableName} (${initialWeight}g)`,
      ALERT_SEVERITY.INFO,
      batch.id
    );

    const io = req.app.get("io");
    if (io) {
      io.emit("batchStarted", batch);
      io.emit("dryerStatus", { dryerOn: true, activeBatch: batch });
    }

    res.status(201).json({ success: true, data: batch, message: "Batch started" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function completeBatch(req, res) {
  try {
    const db = getDB();
    const result = await db.execute({ sql: "SELECT data FROM batches WHERE id = ?", args: [req.params.id] });

    if (!result.rows.length)
      return res.status(404).json({ success: false, message: "Batch not found" });

    const batch = JSON.parse(result.rows[0].data);
    if (batch.status !== "drying")
      return res.status(400).json({ success: false, message: `Batch is already ${batch.status}` });

    const { finalWeight } = req.body;
    if (!finalWeight || isNaN(parseFloat(finalWeight)))
      return res.status(400).json({ success: false, message: "finalWeight is required" });

    const endTime = new Date();
    const durationMinutes = Math.round((endTime - new Date(batch.startTime)) / 60000);
    const fw = parseFloat(finalWeight);
    const weightLoss = batch.initialWeight - fw;
    const weightLossPercent = parseFloat(((weightLoss / batch.initialWeight) * 100).toFixed(2));

    const updatedBatch = {
      ...batch,
      finalWeight: fw,
      weightLoss: parseFloat(weightLoss.toFixed(2)),
      weightLossPercent,
      status: "complete",
      endTime: endTime.toISOString(),
      durationMinutes,
    };

    await db.execute({
      sql: "UPDATE batches SET data = ?, updatedAt = ? WHERE id = ?",
      args: [JSON.stringify(updatedBatch), endTime.toISOString(), batch.id],
    });

    const settingsResult = await db.execute("SELECT value FROM settings WHERE key = 'main'");
    const settings = JSON.parse(settingsResult.rows[0].value);
    await db.execute({
      sql: "UPDATE settings SET value = ? WHERE key = 'main'",
      args: [JSON.stringify({ ...settings, dryerOn: false, updatedAt: endTime.toISOString() })],
    });

    await createAlert(
      ALERT_TYPES.DRYING_COMPLETE,
      `Batch #${updatedBatch.batchNumber} complete! ${updatedBatch.vegetableName} dried for ${durationMinutes} min. Weight reduced from ${updatedBatch.initialWeight}g → ${fw}g (${weightLossPercent}% loss)`,
      ALERT_SEVERITY.INFO,
      batch.id,
      { initialWeight: updatedBatch.initialWeight, finalWeight: fw, weightLossPercent }
    );

    const io = req.app.get("io");
    if (io) {
      io.emit("batchComplete", updatedBatch);
      io.emit("dryerStatus", { dryerOn: false, activeBatch: null });
    }

    res.json({ success: true, data: updatedBatch, message: "Batch completed" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function abortBatch(req, res) {
  try {
    const db = getDB();
    const result = await db.execute({ sql: "SELECT data FROM batches WHERE id = ?", args: [req.params.id] });

    if (!result.rows.length)
      return res.status(404).json({ success: false, message: "Batch not found" });

    const batch = JSON.parse(result.rows[0].data);
    if (batch.status !== "drying")
      return res.status(400).json({ success: false, message: `Batch is already ${batch.status}` });

    const now = new Date().toISOString();
    const updatedBatch = {
      ...batch,
      status: "aborted",
      endTime: now,
      durationMinutes: Math.round((Date.now() - new Date(batch.startTime)) / 60000),
    };

    await db.execute({
      sql: "UPDATE batches SET data = ?, updatedAt = ? WHERE id = ?",
      args: [JSON.stringify(updatedBatch), now, batch.id],
    });

    const settingsResult = await db.execute("SELECT value FROM settings WHERE key = 'main'");
    const settings = JSON.parse(settingsResult.rows[0].value);
    await db.execute({
      sql: "UPDATE settings SET value = ? WHERE key = 'main'",
      args: [JSON.stringify({ ...settings, dryerOn: false, updatedAt: now })],
    });

    await createAlert(ALERT_TYPES.DRYER_STOPPED, `Batch #${batch.batchNumber} was aborted`, ALERT_SEVERITY.WARNING, batch.id);

    const io = req.app.get("io");
    if (io) {
      io.emit("batchAborted", updatedBatch);
      io.emit("dryerStatus", { dryerOn: false, activeBatch: null });
    }

    res.json({ success: true, data: updatedBatch, message: "Batch aborted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getAllBatches, getBatchById, startBatch, completeBatch, abortBatch, getActiveBatch };