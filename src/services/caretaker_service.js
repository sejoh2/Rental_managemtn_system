const db = require('../config/db');
const { normalizePhone, maskPhone } = require('../utils/phone');
const { logAudit } = require('./audit_service');

function getOwnerScope(user) {
  if (user.role === 'admin') return null;
  if (user.role === 'caretaker') return user.owner_id;
  return user.id;
}

function splitName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/);
  return {
    first_name: parts[0] || '',
    last_name: parts.slice(1).join(' ') || '',
  };
}

function publicCaretaker(row) {
  return {
    id: Number(row.id),
    owner_id: row.owner_id ? Number(row.owner_id) : null,
    full_name: row.full_name,
    first_name: row.first_name,
    last_name: row.last_name,
    phone: row.phone,
    phone_masked: maskPhone(row.phone),
    role: row.role,
    status: row.status,
    permission_level: Number(row.permission_level || 1),
    permission_label: getPermissionLabel(row.permission_level || 1),
    property_id: row.property_id ? Number(row.property_id) : null,
    property_name: row.property_name,
    status: row.status,
    notes: row.notes,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getPermissionLabel(level) {
  const labels = {
    1: 'Level 1 - View tenants, submit readings & reports',
    2: 'Level 2 - Also add / edit tenants',
    3: 'Level 3 - Also move out tenants & mark vacant',
  };
  return labels[level] || 'Level 1 - View tenants, submit readings & reports';
}

function getPermissionSummary(level) {
  const summaries = {
    1: 'View only',
    2: 'Add tenants',
    3: 'Full access',
  };
  return summaries[level] || 'View only';
}

async function assertPropertyAccess(user, propertyId) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT id, owner_id, name
        FROM properties
        WHERE id = $1
          AND owner_id = $2
          AND status = 'active'
        `,
        [propertyId, ownerId]
      )
    : await db.query(
        `
        SELECT id, owner_id, name
        FROM properties
        WHERE id = $1
          AND status = 'active'
        `,
        [propertyId]
      );

  if (!result.rows[0]) {
    throw new Error('Property not found or you do not have access to it');
  }

  return result.rows[0];
}

async function listCaretakers(user, filters = {}) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can view caretakers');
  }

  const ownerId = getOwnerScope(user);
  const conditions = [`u.role = 'caretaker'`];
  const params = [];

  if (ownerId) {
    params.push(ownerId);
    conditions.push(`u.owner_id = $${params.length}`);
  }

  if (filters.property_id) {
    await assertPropertyAccess(user, filters.property_id);
    params.push(filters.property_id);
    conditions.push(`p.id = $${params.length}`);
  }

  if (filters.status && filters.status !== 'all') {
    params.push(filters.status);
    conditions.push(`u.status = $${params.length}`);
  }

  if (filters.permission_level) {
    params.push(filters.permission_level);
    conditions.push(`u.permission_level = $${params.length}`);
  }

  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(`(u.first_name ILIKE $${params.length} OR u.last_name ILIKE $${params.length} OR u.phone ILIKE $${params.length})`);
  }

  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const result = await db.query(
    `
    SELECT
      u.id,
      u.first_name,
      u.last_name,
      CONCAT(u.first_name, ' ', u.last_name) AS full_name,
      u.phone,
      u.role,
      u.status,
      u.permission_level,
      u.owner_id,
      u.last_login_at,
      u.created_at,
      u.updated_at,
      p.id AS property_id,
      p.name AS property_name
    FROM users u
    LEFT JOIN properties p ON p.caretaker_id = u.id AND p.status = 'active'
    WHERE ${conditions.join(' AND ')}
    ORDER BY u.created_at DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
    `,
    [...params, limit, offset]
  );

  // Get total count
  const countResult = await db.query(
    `
    SELECT COUNT(*) AS total
    FROM users u
    WHERE ${conditions.join(' AND ')}
    `,
    params
  );

  const caretakers = result.rows.map(publicCaretaker);
  const total = Number(countResult.rows[0].total || 0);

  return {
    caretakers,
    pagination: {
      total,
      limit,
      offset,
      has_more: offset + limit < total,
    },
  };
}

async function getCaretakerById(user, caretakerId) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can view caretaker details');
  }

  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT
          u.id,
          u.first_name,
          u.last_name,
          CONCAT(u.first_name, ' ', u.last_name) AS full_name,
          u.phone,
          u.role,
          u.status,
          u.permission_level,
          u.owner_id,
          u.last_login_at,
          u.created_at,
          u.updated_at,
          p.id AS property_id,
          p.name AS property_name
        FROM users u
        LEFT JOIN properties p ON p.caretaker_id = u.id AND p.status = 'active'
        WHERE u.id = $1
          AND u.role = 'caretaker'
          AND u.owner_id = $2
        `,
        [caretakerId, ownerId]
      )
    : await db.query(
        `
        SELECT
          u.id,
          u.first_name,
          u.last_name,
          CONCAT(u.first_name, ' ', u.last_name) AS full_name,
          u.phone,
          u.role,
          u.status,
          u.permission_level,
          u.owner_id,
          u.last_login_at,
          u.created_at,
          u.updated_at,
          p.id AS property_id,
          p.name AS property_name
        FROM users u
        LEFT JOIN properties p ON p.caretaker_id = u.id AND p.status = 'active'
        WHERE u.id = $1
          AND u.role = 'caretaker'
        `,
        [caretakerId]
      );

  if (!result.rows[0]) {
    throw new Error('Caretaker not found');
  }

  return publicCaretaker(result.rows[0]);
}

async function createCaretaker(user, data, ipAddress) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can create caretakers');
  }

  const ownerId = user.role === 'owner' ? user.id : data.owner_id;

  // Verify the property exists and belongs to this owner
  const property = await assertPropertyAccess(user, data.property_id);

  const normalizedPhone = normalizePhone(data.phone);

  if (!normalizedPhone) {
    throw new Error('A valid phone number is required');
  }

  // Check if phone is already in use
  const existingUser = await db.query(
    `
    SELECT id, role, status
    FROM users
    WHERE phone = $1
    `,
    [normalizedPhone]
  );

  if (existingUser.rows[0]) {
    // If user exists and is a caretaker, we can update them
    if (existingUser.rows[0].role !== 'caretaker') {
      throw new Error('This phone number is already registered with a different role');
    }
  }

  const { first_name, last_name } = splitName(data.full_name);

  // If there's already a caretaker for this property, update them
  const currentCaretaker = await db.query(
    `
    SELECT id, first_name, last_name
    FROM users
    WHERE id = (
      SELECT caretaker_id
      FROM properties
      WHERE id = $1
        AND status = 'active'
    )
    `,
    [data.property_id]
  );

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // If there's a current caretaker, remove their property assignment
    if (currentCaretaker.rows[0]) {
      await client.query(
        `
        UPDATE properties
        SET caretaker_id = NULL
        WHERE id = $1
          AND caretaker_id = $2
        `,
        [data.property_id, currentCaretaker.rows[0].id]
      );
    }

    let caretakerId;

    if (existingUser.rows[0]) {
      // Update existing caretaker
      const updateResult = await client.query(
        `
        UPDATE users
        SET
          first_name = $1,
          last_name = $2,
          permission_level = $3,
          status = 'active',
          owner_id = $4,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $5
        RETURNING *
        `,
        [
          first_name,
          last_name || 'Caretaker',
          data.permission_level || 1,
          ownerId,
          existingUser.rows[0].id,
        ]
      );
      caretakerId = updateResult.rows[0].id;
    } else {
      // Create new caretaker
      const insertResult = await client.query(
        `
        INSERT INTO users (
          first_name,
          last_name,
          phone,
          role,
          status,
          permission_level,
          owner_id,
          created_by
        )
        VALUES ($1, $2, $3, 'caretaker', 'active', $4, $5, $6)
        RETURNING *
        `,
        [
          first_name,
          last_name || 'Caretaker',
          normalizedPhone,
          data.permission_level || 1,
          ownerId,
          user.id,
        ]
      );
      caretakerId = insertResult.rows[0].id;
    }

    // Assign caretaker to property
    await client.query(
      `
      UPDATE properties
      SET caretaker_id = $1
      WHERE id = $2
        AND owner_id = $3
      `,
      [caretakerId, data.property_id, property.owner_id]
    );

    await client.query('COMMIT');

    await logAudit({
      userId: user.id,
      action: currentCaretaker.rows[0] ? 'CARETAKER_REPLACED' : 'CARETAKER_CREATED',
      entityType: 'user',
      entityId: caretakerId,
      metadata: {
        caretaker_name: data.full_name,
        phone: normalizedPhone,
        property_id: data.property_id,
        property_name: property.name,
        permission_level: data.permission_level || 1,
        replaced_caretaker: currentCaretaker.rows[0] ? currentCaretaker.rows[0].first_name + ' ' + currentCaretaker.rows[0].last_name : null,
      },
      ipAddress,
    });

    return getCaretakerById(user, caretakerId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateCaretaker(user, caretakerId, data, ipAddress) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can update caretakers');
  }

  const existing = await getCaretakerById(user, caretakerId);

  if (!existing) {
    throw new Error('Caretaker not found');
  }

  const updates = [];
  const values = [];
  let paramCount = 1;

  if (data.full_name) {
    const { first_name, last_name } = splitName(data.full_name);
    updates.push(`first_name = $${paramCount++}`);
    values.push(first_name);
    updates.push(`last_name = $${paramCount++}`);
    values.push(last_name || 'Caretaker');
  }

  if (data.phone) {
    const normalizedPhone = normalizePhone(data.phone);
    if (!normalizedPhone) {
      throw new Error('A valid phone number is required');
    }
    updates.push(`phone = $${paramCount++}`);
    values.push(normalizedPhone);
  }

  if (data.permission_level !== undefined) {
    updates.push(`permission_level = $${paramCount++}`);
    values.push(data.permission_level);
  }

  if (data.status) {
    updates.push(`status = $${paramCount++}`);
    values.push(data.status);
  }

  if (updates.length === 0 && !data.property_id) {
    throw new Error('No fields to update');
  }

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Update user
    if (updates.length > 0) {
      values.push(caretakerId);
      values.push(existing.owner_id);

      await client.query(
        `
        UPDATE users
        SET ${updates.join(', ')}
        WHERE id = $${paramCount++}
          AND owner_id = $${paramCount}
        `,
        values
      );
    }

    // Update property assignment if changed
    if (data.property_id) {
      // Verify property exists
      const property = await assertPropertyAccess(user, data.property_id);

      // Remove current caretaker from all properties
      await client.query(
        `
        UPDATE properties
        SET caretaker_id = NULL
        WHERE caretaker_id = $1
          AND owner_id = $2
        `,
        [caretakerId, existing.owner_id]
      );

      // Assign to new property
      await client.query(
        `
        UPDATE properties
        SET caretaker_id = $1
        WHERE id = $2
          AND owner_id = $3
        `,
        [caretakerId, data.property_id, property.owner_id]
      );
    }

    await client.query('COMMIT');

    await logAudit({
      userId: user.id,
      action: 'CARETAKER_UPDATED',
      entityType: 'user',
      entityId: caretakerId,
      metadata: {
        updates: data,
      },
      ipAddress,
    });

    return getCaretakerById(user, caretakerId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteCaretaker(user, caretakerId, ipAddress) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can remove caretakers');
  }

  const existing = await getCaretakerById(user, caretakerId);

  if (!existing) {
    throw new Error('Caretaker not found');
  }

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Remove caretaker from property
    await client.query(
      `
      UPDATE properties
      SET caretaker_id = NULL
      WHERE caretaker_id = $1
        AND owner_id = $2
      `,
      [caretakerId, existing.owner_id]
    );

    // Deactivate user
    await client.query(
      `
      UPDATE users
      SET status = 'inactive',
          deactivated_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND owner_id = $2
      `,
      [caretakerId, existing.owner_id]
    );

    await client.query('COMMIT');

    await logAudit({
      userId: user.id,
      action: 'CARETAKER_REMOVED',
      entityType: 'user',
      entityId: caretakerId,
      metadata: {
        caretaker_name: existing.full_name,
        property_id: existing.property_id,
        property_name: existing.property_name,
      },
      ipAddress,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getAvailableProperties(user) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can view properties');
  }

  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT
          p.id,
          p.name,
          u.id AS caretaker_id,
          CONCAT(u.first_name, ' ', u.last_name) AS caretaker_name
        FROM properties p
        LEFT JOIN users u ON u.id = p.caretaker_id
        WHERE p.owner_id = $1
          AND p.status = 'active'
        ORDER BY p.name
        `,
        [ownerId]
      )
    : await db.query(
        `
        SELECT
          p.id,
          p.name,
          u.id AS caretaker_id,
          CONCAT(u.first_name, ' ', u.last_name) AS caretaker_name
        FROM properties p
        LEFT JOIN users u ON u.id = p.caretaker_id
        WHERE p.status = 'active'
        ORDER BY p.name
        `
      );

  return result.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    caretaker_id: row.caretaker_id ? Number(row.caretaker_id) : null,
    caretaker_name: row.caretaker_name || 'None',
  }));
}

async function getCaretakerActivity(user, caretakerId) {
  const existing = await getCaretakerById(user, caretakerId);

  if (!existing) {
    throw new Error('Caretaker not found');
  }

  // Get activity stats
  const stats = await db.query(
    `
    SELECT
      (SELECT COUNT(*) FROM water_meter_readings WHERE submitted_by = $1) AS water_readings,
      (SELECT COUNT(*) FROM maintenance_requests WHERE reported_by = $1 OR assigned_to = $1) AS maintenance_reports,
      (SELECT COUNT(*) FROM expenses WHERE created_by = $1) AS expenses_added
    `,
    [caretakerId]
  );

  // Get recent activity
  const recentActivity = await db.query(
    `
    SELECT
      action,
      entity_type,
      entity_id,
      created_at,
      metadata
    FROM audit_logs
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT 10
    `,
    [caretakerId]
  );

  return {
    stats: {
      water_readings: Number(stats.rows[0].water_readings || 0),
      maintenance_reports: Number(stats.rows[0].maintenance_reports || 0),
      expenses_added: Number(stats.rows[0].expenses_added || 0),
    },
    recent_activity: recentActivity.rows,
  };
}

async function getPermissionLevels() {
  return [
    {
      level: 1,
      label: 'Level 1 - View tenants, submit readings & reports',
      summary: 'View only',
    },
    {
      level: 2,
      label: 'Level 2 - Also add / edit tenants',
      summary: 'Add tenants',
    },
    {
      level: 3,
      label: 'Level 3 - Also move out tenants & mark vacant',
      summary: 'Full access',
    },
  ];
}

module.exports = {
  listCaretakers,
  getCaretakerById,
  createCaretaker,
  updateCaretaker,
  deleteCaretaker,
  getAvailableProperties,
  getCaretakerActivity,
  getPermissionLevels,
  publicCaretaker,
  getPermissionLabel,
  getPermissionSummary,
};