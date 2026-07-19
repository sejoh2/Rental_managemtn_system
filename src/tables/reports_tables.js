const db = require('../config/db');

async function initReportsTables() {
  // Store generated reports for download history
  await db.query(`
    CREATE TABLE IF NOT EXISTS generated_reports (
      id BIGSERIAL PRIMARY KEY,
      owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      report_type VARCHAR(50) NOT NULL,
      report_name VARCHAR(255) NOT NULL,
      filters JSONB NOT NULL DEFAULT '{}'::jsonb,
      file_path VARCHAR(500),
      file_size INTEGER,
      status VARCHAR(30) NOT NULL DEFAULT 'generating',
      generated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      downloaded_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query(`
    ALTER TABLE generated_reports DROP CONSTRAINT IF EXISTS generated_reports_report_type_check;
  `);

  await db.query(`
    ALTER TABLE generated_reports
    ADD CONSTRAINT generated_reports_report_type_check
    CHECK (report_type IN (
      'full_monthly_summary',
      'rent_collection',
      'arrears',
      'water_billing',
      'occupancy',
      'sms_usage',
      'tenant_statement',
      'custom'
    ));
  `);

  await db.query(`
    ALTER TABLE generated_reports DROP CONSTRAINT IF EXISTS generated_reports_status_check;
  `);

  await db.query(`
    ALTER TABLE generated_reports
    ADD CONSTRAINT generated_reports_status_check
    CHECK (status IN ('generating', 'ready', 'failed', 'expired'));
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_generated_reports_owner_id ON generated_reports(owner_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_generated_reports_report_type ON generated_reports(report_type);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_generated_reports_status ON generated_reports(status);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_generated_reports_created_at ON generated_reports(created_at);`);

  await db.query(`
    DROP TRIGGER IF EXISTS update_generated_reports_updated_at ON generated_reports;
  `);

  await db.query(`
    CREATE TRIGGER update_generated_reports_updated_at
    BEFORE UPDATE ON generated_reports
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  console.log('Reports tables initialized successfully');
}

module.exports = initReportsTables;