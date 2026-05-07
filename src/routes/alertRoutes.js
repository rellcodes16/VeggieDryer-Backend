const express = require("express");
const router = express.Router();
const { getAlerts, markAlertRead, markAllAlertsRead, clearAlerts } = require("../controllers/alertController");

router.get("/", getAlerts);                        
router.patch("/:id/read", markAlertRead);           
router.patch("/read-all", markAllAlertsRead);       
router.delete("/", clearAlerts);                    

module.exports = router;
