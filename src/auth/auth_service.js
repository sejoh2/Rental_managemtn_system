const bcrypt = require("bcryptjs");

const db = require("../config/db");

const token_service = require("../security/token_service");

const sms_provider = require("../utils/sms_provider");

const {
    log_audit,
} = require("../audit/audit_service");

const { generate_otp } = require("../utils/otp");
const {
    normalize_phone,
    mask_phone,
} = require("../utils/phone");

async function get_user_by_phone(phone) {
    const normalized_phone = normalize_phone(phone);

    const { rows } = await db.query(
        `
        SELECT *
        FROM users
        WHERE phone = $1
        `,
        [normalized_phone]
    );

    return rows[0] || null;
}

async function get_user_by_id(user_id) {
    const { rows } = await db.query(
        `
        SELECT *
        FROM users
        WHERE user_id = $1
        `,
        [user_id]
    );

    return rows[0] || null;
}

async function get_or_create_user_by_phone(phone) {
    const normalized_phone = normalize_phone(phone);

    const { rows } = await db.query(
        `
        INSERT INTO users (
            first_name,
            last_name,
            phone,
            role,
            status
        )
        VALUES (
            'New',
            'User',
            $1,
            'user',
            'active'
        )
        ON CONFLICT (phone)
        DO UPDATE
        SET phone = EXCLUDED.phone
        RETURNING *;
        `,
        [normalized_phone]
    );

    return rows[0];
}


async function request_otp(phone, ip_address) {
    const normalized_phone = normalize_phone(phone);

    if (!normalized_phone) {
        throw new Error("Phone number is required");
    }

    const user = await get_or_create_user_by_phone(normalized_phone);

    if (user.status !== "active") {
        throw new Error("This account is not active");
    }

    const resend_seconds =
        Number(process.env.OTP_RESEND_SECONDS) || 60;

    const { rows: recent_otps } = await db.query(
        `
        SELECT *
        FROM otp_codes
        WHERE user_id = $1
            AND used_at IS NULL
            AND created_at > CURRENT_TIMESTAMP - ($2 || ' seconds')::INTERVAL
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [user.user_id, resend_seconds]
    );

    if (recent_otps[0]) {
        throw new Error(
            `Please wait ${resend_seconds} seconds before requesting another code`
        );
    }

    await db.query(
        `
        UPDATE otp_codes
        SET used_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
            AND used_at IS NULL
        `,
        [user.user_id]
    );

    const otp = generate_otp(6);

    const code_hash = await bcrypt.hash(otp, 12);

    const expires_minutes =
        Number(process.env.OTP_EXPIRES_MINUTES) || 5;

    const max_attempts =
        Number(process.env.OTP_MAX_ATTEMPTS) || 3;

    await db.query(
        `
        INSERT INTO otp_codes (
            user_id,
            phone,
            code_hash,
            max_attempts,
            expires_at
        )
        VALUES (
            $1,
            $2,
            $3,
            $4,
            CURRENT_TIMESTAMP + ($5 || ' minutes')::INTERVAL
        )
        `,
        [
            user.user_id,
            normalized_phone,
            code_hash,
            max_attempts,
            expires_minutes,
        ]
    );

    await sms_provider.send_sms({
        phone: normalized_phone,
        message: `Your rental management login code is ${otp}. It expires in ${expires_minutes} minutes.`,
    });

    await log_audit({
        user_id: user.user_id,
        action: "OTP_REQUESTED",
        entity_type: "user",
        entity_id: user.user_id,
        metadata: {
            phone: normalized_phone,
            role: user.role,
        },
        ip_address,
    });

    return {
        message: `OTP sent to ${mask_phone(normalized_phone)}`,
        is_new_user:
            user.role === "user" &&
            user.first_name === "New",
    };
}
async function verify_otp(phone, code, ip_address) {
    const normalized_phone = normalize_phone(phone);

    if (!normalized_phone || !code) {
        throw new Error("Phone number and OTP code are required");
    }

    const user = await get_user_by_phone(normalized_phone);

    if (!user) {
        throw new Error("Invalid phone number or code");
    }

    if (user.status !== "active") {
        throw new Error("This account is not active");
    }

    const { rows } = await db.query(
        `
        SELECT *
        FROM otp_codes
        WHERE user_id = $1
            AND phone = $2
            AND used_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [
            user.user_id,
            normalized_phone,
        ]
    );

    const otp_record = rows[0];

    if (!otp_record) {
        throw new Error("Invalid or expired code");
    }

    const { rows: expiry_rows } = await db.query(
        `
        SELECT expires_at <= CURRENT_TIMESTAMP AS expired
        FROM otp_codes
        WHERE otp_code_id = $1
        `,
        [otp_record.otp_code_id]
    );

    if (expiry_rows[0].expired) {
        await db.query(
            `
            UPDATE otp_codes
            SET used_at = CURRENT_TIMESTAMP
            WHERE otp_code_id = $1
            `,
            [otp_record.otp_code_id]
        );

        throw new Error("Code has expired. Please request a new one.");
    }

    if (otp_record.attempts >= otp_record.max_attempts) {
        await db.query(
            `
            UPDATE otp_codes
            SET used_at = CURRENT_TIMESTAMP
            WHERE otp_code_id = $1
            `,
            [otp_record.otp_code_id]
        );

        throw new Error("Too many failed attempts. Please request a new code.");
    }

    const matches = await bcrypt.compare(
        String(code),
        otp_record.code_hash
    );

    if (!matches) {
        await db.query(
            `
            UPDATE otp_codes
            SET attempts = attempts + 1
            WHERE otp_code_id = $1
            `,
            [otp_record.otp_code_id]
        );

        throw new Error("Invalid code");
    }

    await db.query(
        `
        UPDATE otp_codes
        SET used_at = CURRENT_TIMESTAMP
        WHERE otp_code_id = $1
        `,
        [otp_record.otp_code_id]
    );

    await db.query(
        `
        UPDATE users
        SET last_login_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
        `,
        [user.user_id]
    );

    const fresh_user = await get_user_by_id(user.user_id);

    const tokens = await token_service.issue_tokens(fresh_user);

    await log_audit({
        user_id: fresh_user.user_id,
        action: "LOGIN_SUCCESS",
        entity_type: "user",
        entity_id: fresh_user.user_id,
        metadata: {
            role: fresh_user.role,
        },
        ip_address,
    });

    return {
        user: token_service.public_user(fresh_user),
        ...tokens,
    };
}
async function refresh(refresh_token) {
    if (!refresh_token) {
        throw new Error("Refresh token is required");
    }

    const decoded = token_service.verify_refresh_token(refresh_token);

    if (decoded.type !== "refresh") {
        throw new Error("Invalid refresh token");
    }

    const user = await get_user_by_id(decoded.user_id);

    if (!user || user.status !== "active") {
        throw new Error("User not found or inactive");
    }

    const { rows: active_tokens } = await db.query(
        `
        SELECT *
        FROM refresh_tokens
        WHERE user_id = $1
            AND revoked_at IS NULL
            AND expires_at > CURRENT_TIMESTAMP
        ORDER BY created_at DESC
        `,
        [user.user_id]
    );

    let matched_token = null;

    for (const token_record of active_tokens) {
        const matches = await bcrypt.compare(
            refresh_token,
            token_record.token_hash
        );

        if (matches) {
            matched_token = token_record;
            break;
        }
    }

    if (!matched_token) {
        throw new Error("Invalid refresh token");
    }

    await db.query(
        `
        UPDATE refresh_tokens
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE refresh_token_id = $1
        `,
        [matched_token.refresh_token_id]
    );

    const tokens = await token_service.issue_tokens(user);

    return {
        user: token_service.public_user(user),
        ...tokens,
    };
}

async function logout(refresh_token) {
    if (!refresh_token) {
        return;
    }

    const decoded = token_service.verify_refresh_token(refresh_token);

    const { rows: active_tokens } = await db.query(
        `
        SELECT *
        FROM refresh_tokens
        WHERE user_id = $1
            AND revoked_at IS NULL
        `,
        [decoded.user_id]
    );

    for (const token_record of active_tokens) {
        const matches = await bcrypt.compare(
            refresh_token,
            token_record.token_hash
        );

        if (matches) {
            await db.query(
                `
                UPDATE refresh_tokens
                SET revoked_at = CURRENT_TIMESTAMP
                WHERE refresh_token_id = $1
                `,
                [token_record.refresh_token_id]
            );

            break;
        }
    }
}

module.exports = {
    request_otp,
    verify_otp,
    refresh,
    logout,
    get_user_by_id,
    get_user_by_phone,
};