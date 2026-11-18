const express = require("express");
const pool = require("./config/db");

const app = express();

// Lets the server understand JSON sent to it
app.use(express.json());

// Health check: "Are you alive? Can you reach the database?"
app.get("/health", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS time");
    res.json({
      status: "ok",
      message: "The server is alive and the database answered!",
      databaseTime: result.rows[0].time,
    });
  } catch (error) {
    console.error("Database error:", error.message);
    res.status(500).json({
      status: "error",
      message: "The server is alive, but the database is not reachable.",
    });
  }
});

module.exports = app;
