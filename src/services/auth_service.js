const bcrypt = require('bcryptjs');
const db = require('../config/db');
const tokenService = require('./token_service');
const smsProvider = require('../utils/sms_provider');
const { generateOtp } = require('../utils/otp');
const { normalizePhone, maskPhone } = require('../utils/phone');

async function getUserByPhone(phone) {
  const normalizedPhone = normalizePhone(phone);

  const result = await db.query(
    `SELECT * FROM users WHERE phone = $1`,
    [normalizedPhone]
  );

  return result.rows[0];
}

async function getUserById(id) {
  const result = await db.query(
    `SELECT * FROM users WHERE id = $1`,
    [id]
  );

  return result.rows[0];
}

async function getOrCreateUserByPhone(phone) {
  const normalizedPhone = normalizePhone(phone);

  const result = await db.query(
    `
    INSERT INTO users (first_name, last_name, phone, role, status)
    VALUES ('New', 'User', $1, 'user', 'active')
    ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
    RETURNING *
    `,
    [normalizedPhone]
  );

  return result.rows[0];
}

async function logAudit({ userId, action, entityType, entityId, metadata, ipAddress }) {
  await db.query(
    `
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      userId || null,
      action,
      entityType || null,
      entityId || null,
      metadata ? JSON.stringify(metadata) : null,
      ipAddress || null,
    ]
  );
}

async function requestOtp(phone, ipAddress) {
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone) {
    throw new Error('Phone number is required');
  }

  const user = await getOrCreateUserByPhone(normalizedPhone);

  if (user.status !== 'active') {
    throw new Error('This account is not active');
  }

  const resendSeconds = Number(process.env.OTP_RESEND_SECONDS) || 60;

  const recentOtp = await db.query(
    `
    SELECT *
    FROM otp_codes
    WHERE user_id = $1
      AND used_at IS NULL
      AND created_at > CURRENT_TIMESTAMP - ($2 || ' seconds')::INTERVAL
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [user.id, resendSeconds]
  );

  if (recentOtp.rows[0]) {
    throw new Error(`Please wait ${resendSeconds} seconds before requesting another code`);
  }

  await db.query(
    `
    UPDATE otp_codes
    SET used_at = CURRENT_TIMESTAMP
    WHERE user_id = $1
      AND used_at IS NULL
    `,
    [user.id]
  );

  const otp = generateOtp(6);
  const codeHash = await bcrypt.hash(otp, 12);
  const expiresMinutes = Number(process.env.OTP_EXPIRES_MINUTES) || 5;
  const maxAttempts = Number(process.env.OTP_MAX_ATTEMPTS) || 3;

  await db.query(
    `
    INSERT INTO otp_codes (
      user_id,
      phone,
      code_hash,
      max_attempts,
      expires_at
    )
    VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + ($5 || ' minutes')::INTERVAL)
    `,
    [user.id, normalizedPhone, codeHash, maxAttempts, expiresMinutes]
  );

  await smsProvider.sendSms({
  phone: normalizedPhone,
  message: `Your rental management login code is ${otp}. It expires in ${expiresMinutes} minutes.`,
});

  await logAudit({
    userId: user.id,
    action: 'OTP_REQUESTED',
    entityType: 'user',
    entityId: user.id,
    metadata: { phone: normalizedPhone, role: user.role },
    ipAddress,
  });

  return {
    message: `OTP sent to ${maskPhone(normalizedPhone)}`,
    is_new_user: user.role === 'user' && user.first_name === 'New',
  };
}

async function verifyOtp(phone, code, ipAddress) {
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone || !code) {
    throw new Error('Phone number and OTP code are required');
  }

  const user = await getUserByPhone(normalizedPhone);

  if (!user) {
    throw new Error('Invalid phone number or code');
  }

  if (user.status !== 'active') {
    throw new Error('This account is not active');
  }

  const result = await db.query(
    `
    SELECT *
    FROM otp_codes
    WHERE user_id = $1
      AND phone = $2
      AND used_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [user.id, normalizedPhone]
  );

  const otpRecord = result.rows[0];

  if (!otpRecord) {
    throw new Error('Invalid or expired code');
  }

  const expiryCheck = await db.query(
    `
    SELECT expires_at <= CURRENT_TIMESTAMP AS expired
    FROM otp_codes
    WHERE id = $1
    `,
    [otpRecord.id]
  );

  if (expiryCheck.rows[0].expired) {
    await db.query(
      `UPDATE otp_codes SET used_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [otpRecord.id]
    );

    throw new Error('Code has expired. Please request a new one.');
  }

  if (otpRecord.attempts >= otpRecord.max_attempts) {
    await db.query(
      `UPDATE otp_codes SET used_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [otpRecord.id]
    );

    throw new Error('Too many failed attempts. Please request a new code.');
  }

  const matches = await bcrypt.compare(String(code), otpRecord.code_hash);

  if (!matches) {
    await db.query(
      `UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`,
      [otpRecord.id]
    );

    throw new Error('Invalid code');
  }

  await db.query(
    `UPDATE otp_codes SET used_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [otpRecord.id]
  );

  await db.query(
    `UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [user.id]
  );

  const freshUser = await getUserById(user.id);
  const tokens = await tokenService.issueTokens(freshUser);

  await logAudit({
    userId: freshUser.id,
    action: 'LOGIN_SUCCESS',
    entityType: 'user',
    entityId: freshUser.id,
    metadata: { role: freshUser.role },
    ipAddress,
  });

  return {
    user: tokenService.publicUser(freshUser),
    ...tokens,
  };
}

async function refresh(refreshToken) {
  if (!refreshToken) {
    throw new Error('Refresh token is required');
  }

  const decoded = tokenService.verifyRefreshToken(refreshToken);

  if (decoded.type !== 'refresh') {
    throw new Error('Invalid refresh token');
  }

  const user = await getUserById(decoded.id);

  if (!user || user.status !== 'active') {
    throw new Error('User not found or inactive');
  }

  const activeTokens = await db.query(
    `
    SELECT *
    FROM refresh_tokens
    WHERE user_id = $1
      AND revoked_at IS NULL
      AND expires_at > CURRENT_TIMESTAMP
    ORDER BY created_at DESC
    `,
    [user.id]
  );

  let matchedToken = null;

  for (const tokenRecord of activeTokens.rows) {
    const matches = await bcrypt.compare(refreshToken, tokenRecord.token_hash);

    if (matches) {
      matchedToken = tokenRecord;
      break;
    }
  }

  if (!matchedToken) {
    throw new Error('Invalid refresh token');
  }

  await db.query(
    `UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [matchedToken.id]
  );

  const tokens = await tokenService.issueTokens(user);

  return {
    user: tokenService.publicUser(user),
    ...tokens,
  };
}

async function logout(refreshToken) {
  if (!refreshToken) {
    return;
  }

  const decoded = tokenService.verifyRefreshToken(refreshToken);

  const activeTokens = await db.query(
    `
    SELECT *
    FROM refresh_tokens
    WHERE user_id = $1
      AND revoked_at IS NULL
    `,
    [decoded.id]
  );

  for (const tokenRecord of activeTokens.rows) {
    const matches = await bcrypt.compare(refreshToken, tokenRecord.token_hash);

    if (matches) {
      await db.query(
        `UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [tokenRecord.id]
      );
      break;
    }
  }
}

module.exports = {
  requestOtp,
  verifyOtp,
  refresh,
  logout,
  getUserById,
  getUserByPhone,
};