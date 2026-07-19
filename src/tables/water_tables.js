const db = require('../config/db');

const DEFAULT_WATER_DEPOSIT = Number(process.env.DEFAULT_WATER_DEPOSIT_AMOUNT) || 2000;
const DEFAULT_WATER_RATE = Number(process.env.DEFAULT_WATER_RATE_PER_UNIT) || 100;

async function initWaterTables() {
  // Meter readings table
  await db.query(`
    CREATE TABLE IF NOT EXISTS water_meter_readings (
      id BIGSERIAL PRIMARY KEY,
      owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      unit_id BIGINT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
      tenant_id BIGINT REFERENCES tenants(id) ON DELETE SET NULL,
      meter_number VARCHAR(100) NOT NULL,
      previous_reading NUMERIC(12, 2) NOT NULL DEFAULT 0,
      current_reading NUMERIC(12, 2) NOT NULL DEFAULT 0,
      units_used NUMERIC(12, 2) NOT NULL DEFAULT 0,
      reading_date DATE NOT NULL,
      submitted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      photo_url VARCHAR(255),
      notes TEXT,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      flagged BOOLEAN NOT NULL DEFAULT false,
      flag_reason VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query(`
    ALTER TABLE water_meter_readings DROP CONSTRAINT IF EXISTS water_meter_readings_status_check;
  `);

  await db.query(`
    ALTER TABLE water_meter_readings
    ADD CONSTRAINT water_meter_readings_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'billed'));
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_water_readings_owner_id ON water_meter_readings(owner_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_water_readings_property_id ON water_meter_readings(property_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_water_readings_unit_id ON water_meter_readings(unit_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_water_readings_tenant_id ON water_meter_readings(tenant_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_water_readings_reading_date ON water_meter_readings(reading_date);`);

  // Water bills table
  await db.query(`
    CREATE TABLE IF NOT EXISTS water_bills (
      id BIGSERIAL PRIMARY KEY,
      owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      unit_id BIGINT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
      tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      reading_id BIGINT REFERENCES water_meter_readings(id) ON DELETE SET NULL,
      billing_month DATE NOT NULL,
      units_consumed NUMERIC(12, 2) NOT NULL DEFAULT 0,
      rate_per_unit NUMERIC(12, 2) NOT NULL DEFAULT 0,
      total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
      amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
      balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'unpaid',
      due_date DATE,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query(`
    ALTER TABLE water_bills DROP CONSTRAINT IF EXISTS water_bills_status_check;
  `);

  await db.query(`
    ALTER TABLE water_bills
    ADD CONSTRAINT water_bills_status_check
    CHECK (status IN ('unpaid', 'paid', 'partial', 'overdue', 'cancelled'));
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_water_bills_owner_id ON water_bills(owner_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_water_bills_property_id ON water_bills(property_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_water_bills_unit_id ON water_bills(unit_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_water_bills_tenant_id ON water_bills(tenant_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_water_bills_billing_month ON water_bills(billing_month);`);

  // Water payment allocations
  await db.query(`
    CREATE TABLE IF NOT EXISTS water_payment_allocations (
      id BIGSERIAL PRIMARY KEY,
      payment_id BIGINT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      water_bill_id BIGINT NOT NULL REFERENCES water_bills(id) ON DELETE CASCADE,
      amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_water_payment_allocations_payment_id ON water_payment_allocations(payment_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_water_payment_allocations_water_bill_id ON water_payment_allocations(water_bill_id);`);

  // Add water deposit fields to tenants table
  await db.query(`
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS water_deposit_amount NUMERIC(12, 2) NOT NULL DEFAULT ${DEFAULT_WATER_DEPOSIT} CHECK (water_deposit_amount >= 0);
  `);

  await db.query(`
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS water_deposit_paid NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (water_deposit_paid >= 0);
  `);

  // Add electricity deposit fields if not exists
  await db.query(`
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS electricity_deposit_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (electricity_deposit_amount >= 0);
  `);

  await db.query(`
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS electricity_deposit_paid NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (electricity_deposit_paid >= 0);
  `);

  await db.query(`
    DROP TRIGGER IF EXISTS update_water_meter_readings_updated_at ON water_meter_readings;
  `);

  await db.query(`
    CREATE TRIGGER update_water_meter_readings_updated_at
    BEFORE UPDATE ON water_meter_readings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  await db.query(`
    DROP TRIGGER IF EXISTS update_water_bills_updated_at ON water_bills;
  `);

  await db.query(`
    CREATE TRIGGER update_water_bills_updated_at
    BEFORE UPDATE ON water_bills
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  console.log('Water tables initialized successfully');
  console.log(`  Water deposit default: KES ${DEFAULT_WATER_DEPOSIT}`);
  console.log(`  Water rate default: KES ${DEFAULT_WATER_RATE}/unit`);
}

module.exports = initWaterTables;