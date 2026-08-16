const db = require("../config/db");
const { normalize_phone } = require("../utils/phone");

async function create_users_table() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS users (
            user_id BIGSERIAL PRIMARY KEY,

            first_name VARCHAR(100) NOT NULL DEFAULT 'New',

            last_name VARCHAR(100) NOT NULL DEFAULT 'User',

            phone VARCHAR(30) NOT NULL UNIQUE,

            role VARCHAR(50) NOT NULL DEFAULT 'user'
                CHECK (
                    role IN (
                        'admin',
                        'owner',
                        'caretaker',
                        'user'
                    )
                ),

            status VARCHAR(30) NOT NULL DEFAULT 'active'
                CHECK (
                    status IN (
                        'active',
                        'inactive',
                        'suspended'
                    )
                ),

            permission_level INTEGER
                CHECK (
                    permission_level IS NULL
                    OR permission_level >= 1
                ),

            owner_id BIGINT
                REFERENCES users(user_id)
                ON DELETE SET NULL,

            created_by BIGINT
                REFERENCES users(user_id)
                ON DELETE SET NULL,

            last_login_at TIMESTAMPTZ,

            deactivated_at TIMESTAMPTZ,

            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

            CONSTRAINT chk_phone
                CHECK (phone <> ''),

            CONSTRAINT chk_caretaker_permission
                CHECK (
                    role <> 'caretaker'
                    OR permission_level IS NOT NULL
                ),

            CONSTRAINT chk_non_caretaker_permission
                CHECK (
                    role = 'caretaker'
                    OR permission_level IS NULL
                )
        );
    `);

    console.log("[AUTH] Users table ready.");
}

async function create_users_indexes() {
    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_users_phone
        ON users(phone);
    `);

    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_users_role
        ON users(role);
    `);

    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_users_status
        ON users(status);
    `);

    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_users_owner_id
        ON users(owner_id);
    `);

    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_users_created_by
        ON users(created_by);
    `);

    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_users_permission_level
        ON users(permission_level);
    `);

    console.log("[AUTH] Users indexes ready.");
}
async function create_otp_codes_table() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS otp_codes (
            otp_code_id BIGSERIAL PRIMARY KEY,

            user_id BIGINT NOT NULL
                REFERENCES users(user_id)
                ON DELETE CASCADE,

            phone VARCHAR(30) NOT NULL,

            code_hash TEXT NOT NULL,

            purpose VARCHAR(50) NOT NULL DEFAULT 'login'
                CHECK (
                    purpose IN (
                        'login',
                        'phone_change'
                    )
                ),

            attempts INTEGER NOT NULL DEFAULT 0,

            max_attempts INTEGER NOT NULL DEFAULT 3,

            expires_at TIMESTAMPTZ NOT NULL,

            used_at TIMESTAMPTZ,

            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    console.log("[AUTH] OTP codes table ready.");
}

async function create_otp_indexes() {
    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_otp_codes_user_id
        ON otp_codes(user_id);
    `);

    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_otp_codes_phone
        ON otp_codes(phone);
    `);

    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_otp_codes_purpose
        ON otp_codes(purpose);
    `);

    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_otp_codes_expires_at
        ON otp_codes(expires_at);
    `);

    console.log("[AUTH] OTP indexes ready.");
}

async function create_refresh_tokens_table() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS refresh_tokens (
            refresh_token_id BIGSERIAL PRIMARY KEY,

            user_id BIGINT NOT NULL
                REFERENCES users(user_id)
                ON DELETE CASCADE,

            token_hash TEXT NOT NULL,

            expires_at TIMESTAMPTZ NOT NULL,

            revoked_at TIMESTAMPTZ,

            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    console.log("[AUTH] Refresh tokens table ready.");
}

async function create_refresh_token_indexes() {
    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id
        ON refresh_tokens(user_id);
    `);

    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at
        ON refresh_tokens(expires_at);
    `);

    console.log("[AUTH] Refresh token indexes ready.");
}
async function create_audit_logs_table() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
            audit_log_id BIGSERIAL PRIMARY KEY,

            user_id BIGINT
                REFERENCES users(user_id)
                ON DELETE SET NULL,

            action VARCHAR(100) NOT NULL,

            entity_type VARCHAR(100),

            entity_id BIGINT,

            metadata JSONB,

            ip_address VARCHAR(100),

            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    console.log("[AUTH] Audit logs table ready.");
}

async function create_audit_indexes() {
    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id
        ON audit_logs(user_id);
    `);

    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_audit_logs_action
        ON audit_logs(action);
    `);

    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
        ON audit_logs(entity_type, entity_id);
    `);

    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
        ON audit_logs(created_at);
    `);

    console.log("[AUTH] Audit indexes ready.");
}

async function create_update_timestamp_function() {
    await db.query(`
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS
        $$
        BEGIN
            NEW.updated_at = CURRENT_TIMESTAMP;
            RETURN NEW;
        END;
        $$
        LANGUAGE plpgsql;
    `);

    console.log("[AUTH] Timestamp function ready.");
}

async function create_auth_triggers() {
    await db.query(`
        DROP TRIGGER IF EXISTS update_users_updated_at
        ON users;
    `);

    await db.query(`
        CREATE TRIGGER update_users_updated_at
        BEFORE UPDATE
        ON users
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    `);

    console.log("[AUTH] Authentication triggers ready.");
}
async function seed_admin_user() {
    const admin_phone = normalize_phone(process.env.ADMIN_PHONE);

    if (!admin_phone) {
        console.warn("[AUTH] ADMIN_PHONE is not configured. Skipping admin seeding.");
        return;
    }

    await db.query(
        `
        INSERT INTO users (
            first_name,
            last_name,
            phone,
            role,
            status,
            permission_level
        )
        VALUES (
            $1,
            $2,
            $3,
            'admin',
            'active',
            NULL
        )
        ON CONFLICT (phone)
        DO UPDATE SET
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            role = EXCLUDED.role,
            status = EXCLUDED.status;
        `,
        [
            process.env.ADMIN_FIRST_NAME || "System",
            process.env.ADMIN_LAST_NAME || "Admin",
            admin_phone,
        ]
    );

    console.log("[AUTH] Default administrator verified.");
}

async function init_auth_tables() {
    console.log("[AUTH] Initializing authentication tables...");

    await create_users_table();
    await create_users_indexes();

    await create_otp_codes_table();
    await create_otp_indexes();

    await create_refresh_tokens_table();
    await create_refresh_token_indexes();

    await create_audit_logs_table();
    await create_audit_indexes();

    await create_update_timestamp_function();
    await create_auth_triggers();

    await seed_admin_user();

    console.log("[AUTH] Authentication tables initialized.");
}

module.exports = {
    init_auth_tables,
};