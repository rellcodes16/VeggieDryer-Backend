const express = require("express");
const router = express.Router();
const { getDryerStatus, turnDryerOn, turnDryerOff, getESP32Command, updateSettings } = require("../controllers/dryerController");

router.get("/status", getDryerStatus);       
router.post("/on", turnDryerOn);             
router.post("/off", turnDryerOff);    
router.get("/command", getESP32Command); 
router.put("/settings", updateSettings);    

module.exports = router;
