const db = require('../config/db');
const { normalizePhone } = require('../utils/phone');

async function initAuthTables() {
  // ============================================================
  // USERS TABLE
  // ============================================================
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      first_name VARCHAR(100) NOT NULL DEFAULT 'New',
      last_name VARCHAR(100) NOT NULL DEFAULT 'User',
      phone VARCHAR(30) UNIQUE NOT NULL,
      email VARCHAR(255),
      role VARCHAR(50) NOT NULL DEFAULT 'user',
      status VARCHAR(30) NOT NULL DEFAULT 'active',
      owner_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      permission_level INTEGER NOT NULL DEFAULT 1,
      last_login_at TIMESTAMPTZ,
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      deactivated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Add email column if it doesn't exist
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);`);

  // Add permission_level column if it doesn't exist
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS permission_level INTEGER NOT NULL DEFAULT 1;`);

  await db.query(`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';`);
  await db.query(`ALTER TABLE users ALTER COLUMN status SET DEFAULT 'active';`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS owner_id BIGINT REFERENCES users(id) ON DELETE SET NULL;`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id) ON DELETE SET NULL;`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;`);

  await db.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;`);
  await db.query(`
    ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin', 'owner', 'caretaker', 'accountant', 'user'));
  `);

  await db.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;`);
  await db.query(`
    ALTER TABLE users
    ADD CONSTRAINT users_status_check
    CHECK (status IN ('active', 'inactive', 'suspended'));
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_users_owner_id ON users(owner_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_users_permission_level ON users(permission_level);`);

  // ============================================================
  // OTP CODES TABLE
  // ============================================================
  await db.query(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      phone VARCHAR(30) NOT NULL,
      code_hash TEXT NOT NULL,
      purpose VARCHAR(50) NOT NULL DEFAULT 'login',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Add purpose column if it doesn't exist
  await db.query(`ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS purpose VARCHAR(50) NOT NULL DEFAULT 'login';`);

  await db.query(`
    ALTER TABLE otp_codes DROP CONSTRAINT IF EXISTS otp_codes_purpose_check;
  `);

  await db.query(`
    ALTER TABLE otp_codes
    ADD CONSTRAINT otp_codes_purpose_check
    CHECK (purpose IN ('login', 'phone_change'));
  `);

  await db.query(`
    ALTER TABLE otp_codes
    ALTER COLUMN expires_at TYPE TIMESTAMPTZ
    USING expires_at AT TIME ZONE 'UTC';
  `);

  await db.query(`
    ALTER TABLE otp_codes
    ALTER COLUMN used_at TYPE TIMESTAMPTZ
    USING used_at AT TIME ZONE 'UTC';
  `);

  await db.query(`
    ALTER TABLE otp_codes
    ALTER COLUMN created_at TYPE TIMESTAMPTZ
    USING created_at AT TIME ZONE 'UTC';
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_otp_codes_phone ON otp_codes(phone);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_otp_codes_user_id ON otp_codes(user_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_otp_codes_purpose ON otp_codes(purpose);`);

  // ============================================================
  // REFRESH TOKENS TABLE
  // ============================================================
  await db.query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query(`
    ALTER TABLE refresh_tokens
    ALTER COLUMN expires_at TYPE TIMESTAMPTZ
    USING expires_at AT TIME ZONE 'UTC';
  `);

  await db.query(`
    ALTER TABLE refresh_tokens
    ALTER COLUMN revoked_at TYPE TIMESTAMPTZ
    USING revoked_at AT TIME ZONE 'UTC';
  `);

  await db.query(`
    ALTER TABLE refresh_tokens
    ALTER COLUMN created_at TYPE TIMESTAMPTZ
    USING created_at AT TIME ZONE 'UTC';
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);`);

  // ============================================================
  // AUDIT LOGS TABLE
  // ============================================================
  await db.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      action VARCHAR(100) NOT NULL,
      entity_type VARCHAR(100),
      entity_id BIGINT,
      metadata JSONB,
      ip_address VARCHAR(100),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query(`
    ALTER TABLE audit_logs
    ALTER COLUMN created_at TYPE TIMESTAMPTZ
    USING created_at AT TIME ZONE 'UTC';
  `);

  // ============================================================
  // TRIGGERS & FUNCTIONS
  // ============================================================
  await db.query(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = CURRENT_TIMESTAMP;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await db.query(`DROP TRIGGER IF EXISTS update_users_updated_at ON users;`);

  await db.query(`
    CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  // ============================================================
  // ADMIN USER
  // ============================================================
  const adminPhone = normalizePhone(process.env.ADMIN_PHONE);

  if (adminPhone) {
    await db.query(
      `
      INSERT INTO users (first_name, last_name, phone, role, status)
      VALUES ($1, $2, $3, 'admin', 'active')
      ON CONFLICT (phone)
      DO UPDATE SET role = 'admin', status = 'active'
      `,
      [
        process.env.ADMIN_FIRST_NAME || 'System',
        process.env.ADMIN_LAST_NAME || 'Admin',
        adminPhone,
      ]
    );
  }

  console.log('✅ Auth tables initialized successfully');
  console.log('  📧 Email column added to users table');
  console.log('  🔑 Permission level added to users table');
  console.log('  📱 OTP purpose column added for phone change verification');
  console.log('  👤 Accountant role added to users table');
}

module.exports = initAuthTables;