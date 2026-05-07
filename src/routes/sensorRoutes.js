const express = require("express");
const router = express.Router();
const { receiveSensorData, getLatestReading, getSensorHistory } = require("../controllers/sensorController");

router.post("/data", receiveSensorData);      
router.get("/latest", getLatestReading);       
router.get("/history", getSensorHistory);     

module.exports = router;
