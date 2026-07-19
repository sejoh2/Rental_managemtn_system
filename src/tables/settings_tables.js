const db = require('../config/db');

async function initSettingsTables() {
  // Notification preferences table
  await db.query(`
    CREATE TABLE IF NOT EXISTS notification_preferences (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      
      -- SMS Alerts
      sms_payment_received BOOLEAN NOT NULL DEFAULT true,
      sms_rent_reminder BOOLEAN NOT NULL DEFAULT true,
      sms_water_reading_reminder BOOLEAN NOT NULL DEFAULT true,
      sms_suspicious_water BOOLEAN NOT NULL DEFAULT false,
      
      -- Email Summaries
      email_weekly_summary BOOLEAN NOT NULL DEFAULT true,
      email_monthly_report BOOLEAN NOT NULL DEFAULT false,
      
      -- Push Notifications
      push_payment_received BOOLEAN NOT NULL DEFAULT true,
      push_maintenance_assigned BOOLEAN NOT NULL DEFAULT true,
      
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // User invites table
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_invites (
      id BIGSERIAL PRIMARY KEY,
      owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invited_email VARCHAR(255) NOT NULL,
      invited_phone VARCHAR(30),
      role VARCHAR(50) NOT NULL,
      permission_level INTEGER DEFAULT 1,
      property_id BIGINT REFERENCES properties(id) ON DELETE SET NULL,
      token VARCHAR(255) NOT NULL UNIQUE,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query(`
    ALTER TABLE user_invites DROP CONSTRAINT IF EXISTS user_invites_role_check;
  `);

  await db.query(`
    ALTER TABLE user_invites
    ADD CONSTRAINT user_invites_role_check
    CHECK (role IN ('owner', 'caretaker', 'accountant'));
  `);

  await db.query(`
    ALTER TABLE user_invites DROP CONSTRAINT IF EXISTS user_invites_status_check;
  `);

  await db.query(`
    ALTER TABLE user_invites
    ADD CONSTRAINT user_invites_status_check
    CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled'));
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_notification_preferences_user_id ON notification_preferences(user_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_user_invites_owner_id ON user_invites(owner_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_user_invites_token ON user_invites(token);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_user_invites_status ON user_invites(status);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_user_invites_expires_at ON user_invites(expires_at);`);

  await db.query(`
    DROP TRIGGER IF EXISTS update_notification_preferences_updated_at ON notification_preferences;
  `);

  await db.query(`
    CREATE TRIGGER update_notification_preferences_updated_at
    BEFORE UPDATE ON notification_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  await db.query(`
    DROP TRIGGER IF EXISTS update_user_invites_updated_at ON user_invites;
  `);

  await db.query(`
    CREATE TRIGGER update_user_invites_updated_at
    BEFORE UPDATE ON user_invites
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  console.log('Settings tables initialized successfully');
}

module.exports = initSettingsTables;