const db = require('../config/db');

async function initMaintenanceTables() {
  // Maintenance requests table
  await db.query(`
    CREATE TABLE IF NOT EXISTS maintenance_requests (
      id BIGSERIAL PRIMARY KEY,
      owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      unit_id BIGINT REFERENCES units(id) ON DELETE SET NULL,
      
      title VARCHAR(255) NOT NULL,
      description TEXT,
      category VARCHAR(50) NOT NULL,
      
      reported_by BIGINT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
      assigned_to BIGINT REFERENCES users(id) ON DELETE SET NULL,
      
      priority VARCHAR(30) NOT NULL DEFAULT 'medium',
      status VARCHAR(30) NOT NULL DEFAULT 'reported',
      
      estimated_cost NUMERIC(12, 2) DEFAULT 0,
      actual_cost NUMERIC(12, 2) DEFAULT 0,
      
      reported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      assigned_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ,
      resolved_at TIMESTAMPTZ,
      
      notes TEXT,
      attachments JSONB DEFAULT '[]'::jsonb,
      
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Priority check constraint
  await db.query(`
    ALTER TABLE maintenance_requests DROP CONSTRAINT IF EXISTS maintenance_requests_priority_check;
  `);

  await db.query(`
    ALTER TABLE maintenance_requests
    ADD CONSTRAINT maintenance_requests_priority_check
    CHECK (priority IN ('low', 'medium', 'high', 'urgent'));
  `);

  // Status check constraint
  await db.query(`
    ALTER TABLE maintenance_requests DROP CONSTRAINT IF EXISTS maintenance_requests_status_check;
  `);

  await db.query(`
    ALTER TABLE maintenance_requests
    ADD CONSTRAINT maintenance_requests_status_check
    CHECK (status IN ('reported', 'in_progress', 'resolved', 'cancelled'));
  `);

  // Category check constraint
  await db.query(`
    ALTER TABLE maintenance_requests DROP CONSTRAINT IF EXISTS maintenance_requests_category_check;
  `);

  await db.query(`
    ALTER TABLE maintenance_requests
    ADD CONSTRAINT maintenance_requests_category_check
    CHECK (category IN (
      'plumbing',
      'electrical',
      'structural',
      'appliance',
      'furniture',
      'cleaning',
      'security',
      'pest_control',
      'landscaping',
      'other'
    ));
  `);

  // Indexes
  await db.query(`CREATE INDEX IF NOT EXISTS idx_maintenance_owner_id ON maintenance_requests(owner_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_maintenance_property_id ON maintenance_requests(property_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_maintenance_unit_id ON maintenance_requests(unit_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_maintenance_status ON maintenance_requests(status);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_maintenance_assigned_to ON maintenance_requests(assigned_to);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_maintenance_reported_by ON maintenance_requests(reported_by);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_maintenance_reported_at ON maintenance_requests(reported_at);`);

  // Trigger for updated_at
  await db.query(`
    DROP TRIGGER IF EXISTS update_maintenance_requests_updated_at ON maintenance_requests;
  `);

  await db.query(`
    CREATE TRIGGER update_maintenance_requests_updated_at
    BEFORE UPDATE ON maintenance_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  console.log('Maintenance tables initialized successfully');
}

module.exports = initMaintenanceTables;