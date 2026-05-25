require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { initDB, getDB } = require("./src/database");
const { setSocketIO } = require("./src/utils/alertManager");
const apiRoutes = require("./src/routes/index");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173",
      "https://veggiedryer-frontend.onrender.com"
    ],
    methods: ["GET", "POST"]
  }
});

app.set("io", io);
setSocketIO(io);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== "production") {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

app.use("/api", apiRoutes);

app.get("/", (req, res) => {
  res.json({
    message: " Vegetable Dryer API",
    version: "1.0.0",
    docs: {
      health:        "GET  /api/health",
      dryerStatus:   "GET  /api/dryer/status",
      dryerOn:       "POST /api/dryer/on",
      dryerOff:      "POST /api/dryer/off",
      dryerSettings: "PUT  /api/dryer/settings",
      esp32Command:  "GET  /api/dryer/command   <= ESP32 polls this",
      sensorData:    "POST /api/sensor/data     <= ESP32 posts sensor readings",
      latestReading: "GET  /api/sensor/latest",
      sensorHistory: "GET  /api/sensor/history",
      startBatch:    "POST /api/batches/start",
      completeBatch: "PATCH /api/batches/:id/complete",
      abortBatch:    "PATCH /api/batches/:id/abort",
      activeBatch:   "GET  /api/batches/active",
      allBatches:    "GET  /api/batches",
      alerts:        "GET  /api/alerts",
    },
  });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ success: false, message: "Internal server error", error: err.message });
});

io.on("connection", async (socket) => {
  console.log(`Client connected: ${socket.id}`);

  try {
    const client = getDB();

    const settingsResult = await client.execute("SELECT value FROM settings WHERE key = 'main'");
    const settings = JSON.parse(settingsResult.rows[0].value);

    const activeResult = await client.execute(
      "SELECT data FROM batches WHERE json_extract(data, '$.status') = 'drying' LIMIT 1"
    );
    const activeBatch = activeResult.rows.length ? JSON.parse(activeResult.rows[0].data) : null;

    socket.emit("dryerStatus", {
      dryerOn: settings.dryerOn,
      dryingStatus: activeBatch ? "drying" : "idle",
      activeBatch,
    });
  } catch (e) {
    console.error("Error sending initial dryer status to client:", e.message);
  }

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
  });

  socket.on("controlDryer", async (data) => {
    try {
      const client = getDB();

      if (typeof data.dryerOn === "boolean") {
        const settingsResult = await client.execute("SELECT value FROM settings WHERE key = 'main'");
        const settings = JSON.parse(settingsResult.rows[0].value);

        const updated = { ...settings, dryerOn: data.dryerOn, updatedAt: new Date().toISOString() };
        await client.execute({
          sql: "UPDATE settings SET value = ? WHERE key = 'main'",
          args: [JSON.stringify(updated)],
        });

        io.emit("dryerStatus", { dryerOn: data.dryerOn });
      }
    } catch (e) {
      console.error("Error handling controlDryer event:", e.message);
    }
  });
});

const PORT = process.env.PORT || 3000;

async function start() {
  await initDB();
  server.listen(PORT, () => {
    console.log(`\nVegetable Dryer Backend running on http://localhost:${PORT}`);
    console.log(`Socket.IO ready for real-time connections`);
    console.log(`API docs at http://localhost:${PORT}/\n`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});