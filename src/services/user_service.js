const db = require('../config/db');
const bcrypt = require('bcryptjs');
const { logAudit } = require('./audit_service');
const smsProvider = require('../utils/sms_provider');
const { generateOtp } = require('../utils/otp');
const { normalizePhone, maskPhone } = require('../utils/phone');
const crypto = require('crypto');

function getOwnerScope(user) {
  if (user.role === 'admin') return null;
  if (user.role === 'caretaker') return user.owner_id;
  return user.id;
}

// ============================================================
// PROFILE MANAGEMENT
// ============================================================

async function getProfile(user) {
  const result = await db.query(
    `
    SELECT
      id,
      first_name,
      last_name,
      phone,
      email,
      role,
      status,
      owner_id,
      permission_level,
      last_login_at,
      created_at
    FROM users
    WHERE id = $1
    `,
    [user.id]
  );

  if (!result.rows[0]) {
    throw new Error('User not found');
  }

  const row = result.rows[0];
  return {
    id: Number(row.id),
    first_name: row.first_name,
    last_name: row.last_name,
    full_name: `${row.first_name} ${row.last_name}`,
    phone: row.phone,
    email: row.email,
    role: row.role,
    status: row.status,
    owner_id: row.owner_id ? Number(row.owner_id) : null,
    permission_level: Number(row.permission_level || 1),
    last_login_at: row.last_login_at,
    created_at: row.created_at,
  };
}

async function updateProfile(user, data, ipAddress) {
  const updates = [];
  const values = [];
  let paramCount = 1;

  if (data.first_name !== undefined) {
    updates.push(`first_name = $${paramCount++}`);
    values.push(data.first_name);
  }

  if (data.last_name !== undefined) {
    updates.push(`last_name = $${paramCount++}`);
    values.push(data.last_name);
  }

  if (data.email !== undefined) {
    updates.push(`email = $${paramCount++}`);
    values.push(data.email || null);
  }

  if (updates.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(user.id);

  const result = await db.query(
    `
    UPDATE users
    SET ${updates.join(', ')}
    WHERE id = $${paramCount}
    RETURNING *
    `,
    values
  );

  await logAudit({
    userId: user.id,
    action: 'PROFILE_UPDATED',
    entityType: 'user',
    entityId: user.id,
    metadata: data,
    ipAddress,
  });

  return getProfile(user);
}

async function requestPhoneChange(user, newPhone, ipAddress) {
  const normalizedPhone = normalizePhone(newPhone);

  if (!normalizedPhone) {
    throw new Error('Invalid phone number format');
  }

  // Check if phone is already in use
  const existingUser = await db.query(
    `
    SELECT id FROM users WHERE phone = $1 AND id != $2
    `,
    [normalizedPhone, user.id]
  );

  if (existingUser.rows[0]) {
    throw new Error('Phone number is already in use by another account');
  }

  // Generate OTP for phone change verification
  const otp = generateOtp(6);
  const codeHash = await bcrypt.hash(otp, 12);
  const expiresMinutes = Number(process.env.OTP_EXPIRES_MINUTES) || 5;
  const maxAttempts = Number(process.env.OTP_MAX_ATTEMPTS) || 3;

  // Store OTP with phone change purpose
  await db.query(
    `
    INSERT INTO otp_codes (
      user_id,
      phone,
      code_hash,
      purpose,
      max_attempts,
      expires_at
    )
    VALUES ($1, $2, $3, 'phone_change', $4, CURRENT_TIMESTAMP + ($5 || ' minutes')::INTERVAL)
    `,
    [user.id, normalizedPhone, codeHash, maxAttempts, expiresMinutes]
  );

  // Send OTP via SMS
  await smsProvider.sendSms({
    phone: normalizedPhone,
    message: `Your Kodi phone change verification code is ${otp}. It expires in ${expiresMinutes} minutes.`,
  });

  await logAudit({
    userId: user.id,
    action: 'PHONE_CHANGE_REQUESTED',
    entityType: 'user',
    entityId: user.id,
    metadata: { new_phone: maskPhone(normalizedPhone) },
    ipAddress,
  });

  return {
    message: `OTP sent to ${maskPhone(normalizedPhone)}`,
    phone: maskPhone(normalizedPhone),
  };
}

async function verifyPhoneChange(user, newPhone, code, ipAddress) {
  const normalizedPhone = normalizePhone(newPhone);

  if (!normalizedPhone || !code) {
    throw new Error('Phone number and OTP code are required');
  }

  // Verify OTP
  const result = await db.query(
    `
    SELECT *
    FROM otp_codes
    WHERE user_id = $1
      AND phone = $2
      AND purpose = 'phone_change'
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

  // Update phone
  await db.query(
    `
    UPDATE users
    SET phone = $1
    WHERE id = $2
    `,
    [normalizedPhone, user.id]
  );

  await db.query(
    `UPDATE otp_codes SET used_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [otpRecord.id]
  );

  await logAudit({
    userId: user.id,
    action: 'PHONE_CHANGE_COMPLETED',
    entityType: 'user',
    entityId: user.id,
    metadata: { new_phone: maskPhone(normalizedPhone) },
    ipAddress,
  });

  return {
    success: true,
    message: 'Phone number updated successfully',
    phone: maskPhone(normalizedPhone),
  };
}

// ============================================================
// NOTIFICATION PREFERENCES
// ============================================================

async function getNotificationPreferences(user) {
  const result = await db.query(
    `
    SELECT *
    FROM notification_preferences
    WHERE user_id = $1
    `,
    [user.id]
  );

  if (!result.rows[0]) {
    // Create default preferences
    const insertResult = await db.query(
      `
      INSERT INTO notification_preferences (user_id)
      VALUES ($1)
      RETURNING *
      `,
      [user.id]
    );
    return insertResult.rows[0];
  }

  return result.rows[0];
}

async function updateNotificationPreferences(user, data, ipAddress) {
  const updates = [];
  const values = [];
  let paramCount = 1;

  const fields = [
    'sms_payment_received',
    'sms_rent_reminder',
    'sms_water_reading_reminder',
    'sms_suspicious_water',
    'email_weekly_summary',
    'email_monthly_report',
    'push_payment_received',
    'push_maintenance_assigned',
  ];

  for (const field of fields) {
    if (data[field] !== undefined) {
      updates.push(`${field} = $${paramCount++}`);
      values.push(data[field]);
    }
  }

  if (updates.length === 0) {
    throw new Error('No preferences to update');
  }

  values.push(user.id);

  const result = await db.query(
    `
    INSERT INTO notification_preferences (user_id, ${updates.map(f => f.split('=')[0].trim()).join(', ')})
    VALUES ($${paramCount}, ${values.slice(0, -1).map((_, i) => `$${i + 1}`).join(', ')})
    ON CONFLICT (user_id) DO UPDATE SET
      ${updates.join(', ')}
    RETURNING *
    `,
    [...values.slice(0, -1), user.id]
  );

  await logAudit({
    userId: user.id,
    action: 'NOTIFICATION_PREFERENCES_UPDATED',
    entityType: 'user',
    entityId: user.id,
    metadata: data,
    ipAddress,
  });

  return result.rows[0];
}

// ============================================================
// USER INVITES
// ============================================================

async function inviteUser(user, data, ipAddress) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can invite users');
  }

  const ownerId = user.role === 'owner' ? user.id : data.owner_id;

  // Check if email/phone already invited
  if (data.email) {
    const existingInvite = await db.query(
      `
      SELECT id, status
      FROM user_invites
      WHERE invited_email = $1
        AND owner_id = $2
        AND status = 'pending'
      `,
      [data.email, ownerId]
    );

    if (existingInvite.rows[0]) {
      throw new Error('An invite has already been sent to this email');
    }
  }

  if (data.phone) {
    const normalizedPhone = normalizePhone(data.phone);
    const existingInvite = await db.query(
      `
      SELECT id, status
      FROM user_invites
      WHERE invited_phone = $1
        AND owner_id = $2
        AND status = 'pending'
      `,
      [normalizedPhone, ownerId]
    );

    if (existingInvite.rows[0]) {
      throw new Error('An invite has already been sent to this phone number');
    }
  }

  // Generate invite token
  const token = crypto.randomBytes(32).toString('hex');
  const expiresHours = 168; // 7 days

  // If property_id is provided for caretaker, verify it exists
  if (data.property_id && data.role === 'caretaker') {
    const propertyCheck = await db.query(
      `
      SELECT id FROM properties
      WHERE id = $1 AND owner_id = $2 AND status = 'active'
      `,
      [data.property_id, ownerId]
    );

    if (!propertyCheck.rows[0]) {
      throw new Error('Property not found or you do not have access to it');
    }
  }

  const result = await db.query(
    `
    INSERT INTO user_invites (
      owner_id,
      invited_email,
      invited_phone,
      role,
      permission_level,
      property_id,
      token,
      expires_at,
      created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP + ($8 || ' hours')::INTERVAL, $9)
    RETURNING *
    `,
    [
      ownerId,
      data.email || null,
      data.phone ? normalizePhone(data.phone) : null,
      data.role,
      data.permission_level || 1,
      data.property_id || null,
      token,
      expiresHours,
      user.id,
    ]
  );

  // TODO: Send invite email/SMS
  // For now, log it
  console.log(`[INVITE] Token: ${token}`);

  await logAudit({
    userId: user.id,
    action: 'USER_INVITED',
    entityType: 'user_invite',
    entityId: result.rows[0].id,
    metadata: {
      role: data.role,
      email: data.email,
      phone: data.phone ? maskPhone(data.phone) : null,
    },
    ipAddress,
  });

  return {
    id: Number(result.rows[0].id),
    token: token,
    email: data.email,
    phone: data.phone,
    role: data.role,
    expires_at: result.rows[0].expires_at,
  };
}

async function listInvites(user, filters = {}) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can view invites');
  }

  const ownerId = getOwnerScope(user);
  const conditions = [];
  const params = [];

  if (ownerId) {
    params.push(ownerId);
    conditions.push(`owner_id = $${params.length}`);
  }

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }

  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const result = await db.query(
    `
    SELECT
      i.*,
      CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
    FROM user_invites i
    LEFT JOIN users u ON u.id = i.created_by
    WHERE ${conditions.join(' AND ')}
    ORDER BY i.created_at DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
    `,
    [...params, limit, offset]
  );

  const countResult = await db.query(
    `
    SELECT COUNT(*) AS total
    FROM user_invites
    WHERE ${conditions.join(' AND ')}
    `,
    params
  );

  return {
    invites: result.rows.map((row) => ({
      id: Number(row.id),
      email: row.invited_email,
      phone: row.invited_phone,
      role: row.role,
      permission_level: Number(row.permission_level || 1),
      property_id: row.property_id ? Number(row.property_id) : null,
      status: row.status,
      token: row.token,
      expires_at: row.expires_at,
      created_by: row.created_by ? Number(row.created_by) : null,
      created_by_name: row.created_by_name,
      created_at: row.created_at,
    })),
    pagination: {
      total: Number(countResult.rows[0].total || 0),
      limit,
      offset,
      has_more: offset + limit < Number(countResult.rows[0].total || 0),
    },
  };
}

async function cancelInvite(user, inviteId, ipAddress) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can cancel invites');
  }

  const ownerId = getOwnerScope(user);

  const result = await db.query(
    `
    UPDATE user_invites
    SET status = 'cancelled'
    WHERE id = $1
      AND owner_id = $2
      AND status = 'pending'
    RETURNING *
    `,
    [inviteId, ownerId]
  );

  if (!result.rows[0]) {
    throw new Error('Invite not found or already processed');
  }

  await logAudit({
    userId: user.id,
    action: 'USER_INVITE_CANCELLED',
    entityType: 'user_invite',
    entityId: inviteId,
    metadata: {
      email: result.rows[0].invited_email,
      phone: result.rows[0].invited_phone,
    },
    ipAddress,
  });

  return { success: true, message: 'Invite cancelled successfully' };
}

async function acceptInvite(token, userData, ipAddress) {
  const result = await db.query(
    `
    SELECT *
    FROM user_invites
    WHERE token = $1
      AND status = 'pending'
      AND expires_at > CURRENT_TIMESTAMP
    `,
    [token]
  );

  if (!result.rows[0]) {
    throw new Error('Invalid or expired invite token');
  }

  const invite = result.rows[0];

  // Create the user
  const { first_name, last_name } = splitName(userData.full_name || 'New User');
  const normalizedPhone = normalizePhone(userData.phone);

  if (!normalizedPhone) {
    throw new Error('Valid phone number is required');
  }

  // Check if phone already exists
  const existingUser = await db.query(
    `
    SELECT id FROM users WHERE phone = $1
    `,
    [normalizedPhone]
  );

  if (existingUser.rows[0]) {
    throw new Error('Phone number is already registered');
  }

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Create user
    const userResult = await client.query(
      `
      INSERT INTO users (
        first_name,
        last_name,
        phone,
        email,
        role,
        status,
        owner_id,
        permission_level,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8)
      RETURNING *
      `,
      [
        first_name,
        last_name || 'User',
        normalizedPhone,
        invite.invited_email || null,
        invite.role,
        invite.owner_id,
        invite.permission_level || 1,
        invite.created_by,
      ]
    );

    const newUser = userResult.rows[0];

    // If caretaker, assign to property
    if (invite.role === 'caretaker' && invite.property_id) {
      // Remove current caretaker from property
      await client.query(
        `
        UPDATE properties
        SET caretaker_id = NULL
        WHERE id = $1
        `,
        [invite.property_id]
      );

      // Assign new caretaker
      await client.query(
        `
        UPDATE properties
        SET caretaker_id = $1
        WHERE id = $2
        `,
        [newUser.id, invite.property_id]
      );
    }

    // Mark invite as accepted
    await client.query(
      `
      UPDATE user_invites
      SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP
      WHERE id = $1
      `,
      [invite.id]
    );

    await client.query('COMMIT');

    await logAudit({
      userId: newUser.id,
      action: 'USER_INVITE_ACCEPTED',
      entityType: 'user',
      entityId: newUser.id,
      metadata: {
        invite_id: invite.id,
        role: invite.role,
        property_id: invite.property_id,
      },
      ipAddress,
    });

    return {
      success: true,
      message: 'Invite accepted successfully',
      user: {
        id: newUser.id,
        first_name: newUser.first_name,
        last_name: newUser.last_name,
        phone: newUser.phone,
        role: newUser.role,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function splitName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/);
  return {
    first_name: parts[0] || '',
    last_name: parts.slice(1).join(' ') || '',
  };
}

// ============================================================
// AUDIT LOG
// ============================================================

async function getAuditLogs(user, filters = {}) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can view audit logs');
  }

  const ownerId = getOwnerScope(user);
  const conditions = [];
  const params = [];

  if (ownerId) {
    params.push(ownerId);
    conditions.push(`(user_id IN (SELECT id FROM users WHERE owner_id = $${params.length} OR id = $${params.length}))`);
  }

  if (filters.user_id) {
    params.push(filters.user_id);
    conditions.push(`user_id = $${params.length}`);
  }

  if (filters.action) {
    params.push(`%${filters.action}%`);
    conditions.push(`action ILIKE $${params.length}`);
  }

  if (filters.entity_type) {
    params.push(filters.entity_type);
    conditions.push(`entity_type = $${params.length}`);
  }

  if (filters.start_date) {
    params.push(filters.start_date);
    conditions.push(`created_at >= $${params.length}`);
  }

  if (filters.end_date) {
    params.push(filters.end_date);
    conditions.push(`created_at <= $${params.length}`);
  }

  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const result = await db.query(
    `
    SELECT
      a.*,
      CONCAT(u.first_name, ' ', u.last_name) AS user_name,
      u.role AS user_role
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY a.created_at DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
    `,
    [...params, limit, offset]
  );

  const countResult = await db.query(
    `
    SELECT COUNT(*) AS total
    FROM audit_logs a
    WHERE ${conditions.join(' AND ')}
    `,
    params
  );

  return {
    logs: result.rows.map((row) => ({
      id: Number(row.id),
      user_id: row.user_id ? Number(row.user_id) : null,
      user_name: row.user_name,
      user_role: row.user_role,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id ? Number(row.entity_id) : null,
      metadata: row.metadata,
      ip_address: row.ip_address,
      created_at: row.created_at,
    })),
    pagination: {
      total: Number(countResult.rows[0].total || 0),
      limit,
      offset,
      has_more: offset + limit < Number(countResult.rows[0].total || 0),
    },
  };
}

async function getAuditLogStats(user) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can view audit logs');
  }

  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT
          COUNT(*) AS total_actions,
          COUNT(DISTINCT user_id) AS unique_users,
          MIN(created_at) AS first_action,
          MAX(created_at) AS last_action,
          jsonb_object_agg(action, count) AS action_counts
        FROM (
          SELECT
            action,
            COUNT(*) AS count
          FROM audit_logs
          WHERE user_id IN (SELECT id FROM users WHERE owner_id = $1 OR id = $1)
          GROUP BY action
        ) sub
        `,
        [ownerId]
      )
    : await db.query(
        `
        SELECT
          COUNT(*) AS total_actions,
          COUNT(DISTINCT user_id) AS unique_users,
          MIN(created_at) AS first_action,
          MAX(created_at) AS last_action,
          jsonb_object_agg(action, count) AS action_counts
        FROM (
          SELECT
            action,
            COUNT(*) AS count
          FROM audit_logs
          GROUP BY action
        ) sub
        `
      );

  const stats = result.rows[0];
  return {
    total_actions: Number(stats.total_actions || 0),
    unique_users: Number(stats.unique_users || 0),
    first_action: stats.first_action,
    last_action: stats.last_action,
    action_counts: stats.action_counts || {},
  };
}

module.exports = {
  getProfile,
  updateProfile,
  requestPhoneChange,
  verifyPhoneChange,
  getNotificationPreferences,
  updateNotificationPreferences,
  inviteUser,
  listInvites,
  cancelInvite,
  acceptInvite,
  getAuditLogs,
  getAuditLogStats,
};