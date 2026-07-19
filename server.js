const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');

dotenv.config();

const db = require('./src/config/db');
const initAuthTables = require('./src/tables/auth_tables');
const initPropertyTables = require('./src/tables/property_tables');
const initUnitTables = require('./src/tables/unit_tables');
const initTenantTables = require('./src/tables/tenant_tables');
const initAgreementTables = require('./src/tables/agreement_tables');
const initPaymentTables = require('./src/tables/payment_tables');
const initWaterTables = require('./src/tables/water_tables');
const initExpenseTables = require('./src/tables/expense_tables');
const initMaintenanceTables = require('./src/tables/maintenance_tables');
const initSmsTables = require('./src/tables/sms_tables');
const initReportsTables = require('./src/tables/reports_tables');
const initSettingsTables = require('./src/tables/settings_tables');

const authRoutes = require('./src/routes/auth_routes');
const propertyRoutes = require('./src/routes/property_routes');
const unitRoutes = require('./src/routes/unit_routes');
const tenantRoutes = require('./src/routes/tenant_routes');
const agreementRoutes = require('./src/routes/agreement_routes');
const paymentRoutes = require('./src/routes/payment_routes');
const waterRoutes = require('./src/routes/water_routes');
const expenseRoutes = require('./src/routes/expense_routes');
const maintenanceRoutes = require('./src/routes/maintenance_routes');
const caretakerRoutes = require('./src/routes/caretaker_routes');
const smsRoutes = require('./src/routes/sms_routes');
const reportRoutes = require('./src/routes/report_routes');
const userRoutes = require('./src/routes/user_routes');
const mpesaRoutes = require('./src/routes/mpesa_routes');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', async (req, res) => {
  try {
    const result = await db.query('SELECT NOW()');

    res.status(200).json({
      success: true,
      status: 'healthy',
      timestamp: result.rows[0].now,
      message: 'Rental Management backend is running',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
    });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/units', unitRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/agreements', agreementRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/payments/mpesa', mpesaRoutes);
app.use('/api/water', waterRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/caretakers', caretakerRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
  });
});

async function startServer() {
  try {
    await initAuthTables();
    await initPropertyTables();
    await initUnitTables();
    await initTenantTables();
    await initAgreementTables();
    await initPaymentTables();
    await initWaterTables();
    await initExpenseTables();
    await initMaintenanceTables();
    await initSmsTables();
    await initReportsTables();
    await initSettingsTables();

    await db.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS email VARCHAR(255);
    `);

    await db.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS permission_level INTEGER NOT NULL DEFAULT 1;
    `);

    console.log('All tables initialized successfully');

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log('M-Pesa C2B endpoints:');
      console.log('POST /api/payments/mpesa/accounts/:paymentAccountId/connect');
      console.log('POST /api/payments/mpesa/simulate');
      console.log('POST /api/payments/mpesa/c2b/validation');
      console.log('POST /api/payments/mpesa/c2b/confirmation');
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();