const { getDB } = require("../database");

async function getAlerts(req, res) {
  try {
    const db = getDB();
    const { unreadOnly, batchId, limit = 50 } = req.query;

    let sql = "SELECT data FROM alerts WHERE 1=1";
    const args = [];

    if (unreadOnly === "true") {
      sql += " AND json_extract(data, '$.read') = false";
    }
    if (batchId) {
      sql += " AND json_extract(data, '$.batchId') = ?";
      args.push(batchId);
    }

    sql += " ORDER BY createdAt DESC LIMIT ?";
    args.push(parseInt(limit));

    const result = await db.execute({ sql, args });
    const alerts = result.rows.map((r) => JSON.parse(r.data));

    const unreadResult = await db.execute(
      "SELECT COUNT(*) as count FROM alerts WHERE json_extract(data, '$.read') = false"
    );
    const unreadCount = unreadResult.rows[0].count;

    res.json({ success: true, data: alerts, unreadCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function markAlertRead(req, res) {
  try {
    const db = getDB();
    const result = await db.execute({ sql: "SELECT data FROM alerts WHERE id = ?", args: [req.params.id] });

    if (!result.rows.length)
      return res.status(404).json({ success: false, message: "Alert not found" });

    const alert = JSON.parse(result.rows[0].data);
    const updated = { ...alert, read: true };

    await db.execute({
      sql: "UPDATE alerts SET data = ? WHERE id = ?",
      args: [JSON.stringify(updated), alert.id],
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function markAllAlertsRead(req, res) {
  try {
    const client = getDB();

    const result = await client.execute("SELECT id, data FROM alerts");

    const updates = result.rows.map((r) => ({
      sql: "UPDATE alerts SET data = ? WHERE id = ?",
      args: [JSON.stringify({ ...JSON.parse(r.data), read: true }), r.id],
    }));

    if (updates.length) await client.batch(updates, "write");

    res.json({ success: true, message: "All alerts marked as read" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function clearAlerts(req, res) {
  try {
    const db = getDB();
    await db.execute("DELETE FROM alerts");
    res.json({ success: true, message: "All alerts cleared" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getAlerts, markAlertRead, markAllAlertsRead, clearAlerts };