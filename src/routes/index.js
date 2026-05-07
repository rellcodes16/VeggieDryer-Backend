const express = require("express");
const router = express.Router();

const batchRoutes = require("./batchRoutes");
const sensorRoutes = require("./sensorRoutes");
const dryerRoutes = require("./dryerRoutes");
const alertRoutes = require("./alertRoutes");

router.use("/batches", batchRoutes);
router.use("/sensor", sensorRoutes);
router.use("/dryer", dryerRoutes);
router.use("/alerts", alertRoutes);

router.get("/health", (req, res) => {
  res.json({ success: true, message: "Dryer API is running", timestamp: new Date().toISOString() });
});

module.exports = router;
