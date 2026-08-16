const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const db = require("./src/config/db");

const auth_routes = require("./src/auth/auth_routes");
const property_routes = require("./src/properties/property_routes");
const payment_routes = require("./src/payments/payment_routes");

const app = express();

/*
|--------------------------------------------------------------------------
| Global Middleware
|--------------------------------------------------------------------------
*/

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/*
|--------------------------------------------------------------------------
| Health Check
|--------------------------------------------------------------------------
*/

app.get("/health", async (req, res) => {
    try {
        const result = await db.query("SELECT NOW()");

        return res.status(200).json({
            success: true,
            status: "healthy",
            timestamp: result.rows[0].now,
            message: "Rental Management Backend is running",
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            status: "unhealthy",
            error: error.message,
        });
    }
});

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
*/

app.use("/api/auth", auth_routes);
app.use("/api/properties", property_routes);
app.use("/api/payments", payment_routes);

/*
|--------------------------------------------------------------------------
| 404 Handler
|--------------------------------------------------------------------------
*/

app.use((req, res) => {
    return res.status(404).json({
        success: false,
        error: "Route not found",
    });
});

module.exports = app;