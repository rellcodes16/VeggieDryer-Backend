const express = require("express");
const router = express.Router();
const {
  getAllBatches,
  getBatchById,
  startBatch,
  completeBatch,
  abortBatch,
  getActiveBatch,
} = require("../controllers/batchController");

router.get("/", getAllBatches);           
router.get("/active", getActiveBatch);    
router.get("/:id", getBatchById);         
router.post("/start", startBatch);        
router.patch("/:id/complete", completeBatch); 
router.patch("/:id/abort", abortBatch);   

module.exports = router;
