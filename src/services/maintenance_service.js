const db = require('../config/db');
const { logAudit } = require('./audit_service');

function getOwnerScope(user) {
  if (user.role === 'admin') return null;
  if (user.role === 'caretaker') return user.owner_id;
  return user.id;
}

const categoryLabels = {
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  structural: 'Structural',
  appliance: 'Appliance',
  furniture: 'Furniture',
  cleaning: 'Cleaning',
  security: 'Security',
  pest_control: 'Pest Control',
  landscaping: 'Landscaping',
  other: 'Other',
};

const priorityLabels = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

const priorityColors = {
  low: '#2E7D4F',
  medium: '#B8790E',
  high: '#B3261E',
  urgent: '#B3261E',
};

const statusLabels = {
  reported: 'Reported',
  in_progress: 'In progress',
  resolved: 'Resolved',
  cancelled: 'Cancelled',
};

const statusColors = {
  reported: '#B3261E',
  in_progress: '#B8790E',
  resolved: '#2E7D4F',
  cancelled: '#A39B8D',
};

function publicMaintenance(row) {
  return {
    id: Number(row.id),
    owner_id: Number(row.owner_id),
    property_id: Number(row.property_id),
    property_name: row.property_name,
    unit_id: row.unit_id ? Number(row.unit_id) : null,
    unit_number: row.unit_number,
    title: row.title,
    description: row.description,
    category: row.category,
    category_label: categoryLabels[row.category] || row.category,
    priority: row.priority,
    priority_label: priorityLabels[row.priority] || row.priority,
    priority_color: priorityColors[row.priority] || '#A39B8D',
    status: row.status,
    status_label: statusLabels[row.status] || row.status,
    status_color: statusColors[row.status] || '#A39B8D',
    reported_by: Number(row.reported_by),
    reported_by_name: row.reported_by_name,
    reported_by_role: row.reported_by_role,
    assigned_to: row.assigned_to ? Number(row.assigned_to) : null,
    assigned_to_name: row.assigned_to_name,
    estimated_cost: Number(row.estimated_cost || 0),
    estimated_cost_display: formatMoney(row.estimated_cost || 0),
    actual_cost: Number(row.actual_cost || 0),
    actual_cost_display: formatMoney(row.actual_cost || 0),
    reported_at: row.reported_at,
    assigned_at: row.assigned_at,
    started_at: row.started_at,
    resolved_at: row.resolved_at,
    notes: row.notes,
    attachments: row.attachments || [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function formatMoney(amount) {
  return `KES ${Number(amount || 0).toLocaleString('en-KE')}`;
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

async function assertUnitAccess(user, unitId) {
  if (!unitId) return null;

  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT u.*, p.name AS property_name
        FROM units u
        INNER JOIN properties p ON p.id = u.property_id
        WHERE u.id = $1
          AND u.owner_id = $2
          AND u.status != 'archived'
        `,
        [unitId, ownerId]
      )
    : await db.query(
        `
        SELECT u.*, p.name AS property_name
        FROM units u
        INNER JOIN properties p ON p.id = u.property_id
        WHERE u.id = $1
          AND u.status != 'archived'
        `,
        [unitId]
      );

  if (!result.rows[0]) {
    throw new Error('Unit not found or you do not have access to it');
  }

  return result.rows[0];
}

async function assertCaretakerAccess(user, propertyId) {
  if (user.role !== 'caretaker') return;

  const result = await db.query(
    `
    SELECT id
    FROM properties
    WHERE id = $1
      AND caretaker_id = $2
      AND status = 'active'
    `,
    [propertyId, user.id]
  );

  if (!result.rows[0]) {
    throw new Error('You do not have access to this property');
  }
}

async function listMaintenance(user, filters = {}) {
  const ownerId = getOwnerScope(user);
  const conditions = [];
  const params = [];

  // Owner/Caretaker scope
  if (ownerId) {
    params.push(ownerId);
    conditions.push(`m.owner_id = $${params.length}`);
  }

  // If caretaker, only show their assigned requests or requests from their property
  if (user.role === 'caretaker') {
    const caretakerProperties = await db.query(
      `
      SELECT id FROM properties
      WHERE caretaker_id = $1 AND status = 'active'
      `,
      [user.id]
    );
    
    const propertyIds = caretakerProperties.rows.map(r => r.id);
    if (propertyIds.length > 0) {
      const placeholders = propertyIds.map((_, i) => `$${params.length + i + 1}`).join(',');
      params.push(...propertyIds);
      conditions.push(`(m.assigned_to = $${params.length - propertyIds.length} OR m.property_id IN (${placeholders}))`);
    } else {
      // No properties assigned - show nothing
      params.push(0);
      conditions.push(`m.assigned_to = $${params.length}`);
    }
  }

  // Filters
  if (filters.property_id) {
    await assertPropertyAccess(user, filters.property_id);
    params.push(filters.property_id);
    conditions.push(`m.property_id = $${params.length}`);
  }

  if (filters.unit_id) {
    await assertUnitAccess(user, filters.unit_id);
    params.push(filters.unit_id);
    conditions.push(`m.unit_id = $${params.length}`);
  }

  if (filters.status && filters.status !== 'all') {
    params.push(filters.status);
    conditions.push(`m.status = $${params.length}`);
  }

  if (filters.priority) {
    params.push(filters.priority);
    conditions.push(`m.priority = $${params.length}`);
  }

  if (filters.category) {
    params.push(filters.category);
    conditions.push(`m.category = $${params.length}`);
  }

  if (filters.assigned_to) {
    params.push(filters.assigned_to);
    conditions.push(`m.assigned_to = $${params.length}`);
  }

  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(`(m.title ILIKE $${params.length} OR m.description ILIKE $${params.length})`);
  }

  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const result = await db.query(
    `
    SELECT
      m.*,
      p.name AS property_name,
      u.unit_number,
      CONCAT(reporter.first_name, ' ', reporter.last_name) AS reported_by_name,
      reporter.role AS reported_by_role,
      CONCAT(assignee.first_name, ' ', assignee.last_name) AS assigned_to_name
    FROM maintenance_requests m
    INNER JOIN properties p ON p.id = m.property_id
    LEFT JOIN units u ON u.id = m.unit_id
    LEFT JOIN users reporter ON reporter.id = m.reported_by
    LEFT JOIN users assignee ON assignee.id = m.assigned_to
    WHERE ${conditions.join(' AND ')}
    ORDER BY 
      CASE m.priority
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
      END,
      m.reported_at DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
    `,
    [...params, limit, offset]
  );

  // Get total count
  const countResult = await db.query(
    `
    SELECT COUNT(*) AS total
    FROM maintenance_requests m
    WHERE ${conditions.join(' AND ')}
    `,
    params
  );

  const requests = result.rows.map(publicMaintenance);
  const total = Number(countResult.rows[0].total || 0);

  return {
    requests,
    pagination: {
      total,
      limit,
      offset,
      has_more: offset + limit < total,
    },
  };
}

async function createMaintenance(user, data, ipAddress) {
  if (!['admin', 'owner', 'caretaker'].includes(user.role)) {
    throw new Error('You are not allowed to create maintenance requests');
  }

  const property = await assertPropertyAccess(user, data.property_id);
  
  // If caretaker, verify they have access to this property
  if (user.role === 'caretaker') {
    await assertCaretakerAccess(user, data.property_id);
  }

  if (data.unit_id) {
    await assertUnitAccess(user, data.unit_id);
  }

  const result = await db.query(
    `
    INSERT INTO maintenance_requests (
      owner_id,
      property_id,
      unit_id,
      title,
      description,
      category,
      priority,
      estimated_cost,
      reported_by,
      notes,
      attachments
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
    `,
    [
      property.owner_id,
      data.property_id,
      data.unit_id || null,
      data.title,
      data.description || null,
      data.category,
      data.priority || 'medium',
      data.estimated_cost || 0,
      user.id,
      data.notes || null,
      JSON.stringify(data.attachments || []),
    ]
  );

  await logAudit({
    userId: user.id,
    action: 'MAINTENANCE_CREATED',
    entityType: 'maintenance_request',
    entityId: result.rows[0].id,
    metadata: {
      property_id: data.property_id,
      property_name: property.name,
      title: data.title,
      category: data.category,
      priority: data.priority,
    },
    ipAddress,
  });

  return getMaintenanceById(user, result.rows[0].id);
}

async function getMaintenanceById(user, requestId) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT
          m.*,
          p.name AS property_name,
          u.unit_number,
          CONCAT(reporter.first_name, ' ', reporter.last_name) AS reported_by_name,
          reporter.role AS reported_by_role,
          CONCAT(assignee.first_name, ' ', assignee.last_name) AS assigned_to_name
        FROM maintenance_requests m
        INNER JOIN properties p ON p.id = m.property_id
        LEFT JOIN units u ON u.id = m.unit_id
        LEFT JOIN users reporter ON reporter.id = m.reported_by
        LEFT JOIN users assignee ON assignee.id = m.assigned_to
        WHERE m.id = $1
          AND m.owner_id = $2
        `,
        [requestId, ownerId]
      )
    : await db.query(
        `
        SELECT
          m.*,
          p.name AS property_name,
          u.unit_number,
          CONCAT(reporter.first_name, ' ', reporter.last_name) AS reported_by_name,
          reporter.role AS reported_by_role,
          CONCAT(assignee.first_name, ' ', assignee.last_name) AS assigned_to_name
        FROM maintenance_requests m
        INNER JOIN properties p ON p.id = m.property_id
        LEFT JOIN units u ON u.id = m.unit_id
        LEFT JOIN users reporter ON reporter.id = m.reported_by
        LEFT JOIN users assignee ON assignee.id = m.assigned_to
        WHERE m.id = $1
        `,
        [requestId]
      );

  if (!result.rows[0]) {
    return null;
  }

  // If caretaker, verify they have access
  if (user.role === 'caretaker') {
    const request = result.rows[0];
    const caretakerAccess = await db.query(
      `
      SELECT id FROM properties
      WHERE id = $1 AND caretaker_id = $2 AND status = 'active'
      `,
      [request.property_id, user.id]
    );
    
    if (!caretakerAccess.rows[0] && request.assigned_to !== user.id) {
      throw new Error('You do not have access to this maintenance request');
    }
  }

  return publicMaintenance(result.rows[0]);
}

async function updateMaintenance(user, requestId, data, ipAddress) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can update maintenance requests');
  }

  const existing = await getMaintenanceById(user, requestId);

  if (!existing) {
    throw new Error('Maintenance request not found');
  }

  const updates = [];
  const values = [];
  let paramCount = 1;

  if (data.property_id !== undefined) {
    await assertPropertyAccess(user, data.property_id);
    updates.push(`property_id = $${paramCount++}`);
    values.push(data.property_id);
  }

  if (data.unit_id !== undefined) {
    if (data.unit_id) {
      await assertUnitAccess(user, data.unit_id);
    }
    updates.push(`unit_id = $${paramCount++}`);
    values.push(data.unit_id || null);
  }

  if (data.title !== undefined) {
    updates.push(`title = $${paramCount++}`);
    values.push(data.title);
  }

  if (data.description !== undefined) {
    updates.push(`description = $${paramCount++}`);
    values.push(data.description);
  }

  if (data.category !== undefined) {
    updates.push(`category = $${paramCount++}`);
    values.push(data.category);
  }

  if (data.priority !== undefined) {
    updates.push(`priority = $${paramCount++}`);
    values.push(data.priority);
  }

  if (data.estimated_cost !== undefined) {
    updates.push(`estimated_cost = $${paramCount++}`);
    values.push(data.estimated_cost);
  }

  if (data.assigned_to !== undefined) {
    updates.push(`assigned_to = $${paramCount++}`);
    values.push(data.assigned_to || null);
    if (data.assigned_to) {
      updates.push(`assigned_at = CURRENT_TIMESTAMP`);
    }
  }

  if (data.notes !== undefined) {
    updates.push(`notes = $${paramCount++}`);
    values.push(data.notes);
  }

  if (data.attachments !== undefined) {
    updates.push(`attachments = $${paramCount++}`);
    values.push(JSON.stringify(data.attachments));
  }

  if (updates.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(requestId);
  values.push(existing.owner_id);

  await db.query(
    `
    UPDATE maintenance_requests
    SET ${updates.join(', ')}
    WHERE id = $${paramCount++}
      AND owner_id = $${paramCount}
    `,
    values
  );

  await logAudit({
    userId: user.id,
    action: 'MAINTENANCE_UPDATED',
    entityType: 'maintenance_request',
    entityId: requestId,
    metadata: data,
    ipAddress,
  });

  return getMaintenanceById(user, requestId);
}

async function updateStatus(user, requestId, data, ipAddress) {
  // Allow owner, admin, and caretaker (if assigned) to update status
  const existing = await getMaintenanceById(user, requestId);

  if (!existing) {
    throw new Error('Maintenance request not found');
  }

  // Check if caretaker is assigned to this request
  if (user.role === 'caretaker' && existing.assigned_to !== user.id) {
    // Check if caretaker is assigned to the property
    const propertyAccess = await db.query(
      `
      SELECT id FROM properties
      WHERE id = $1 AND caretaker_id = $2 AND status = 'active'
      `,
      [existing.property_id, user.id]
    );
    
    if (!propertyAccess.rows[0]) {
      throw new Error('You are not authorized to update this request');
    }
  }

  const updates = [];
  const values = [];
  let paramCount = 1;

  updates.push(`status = $${paramCount++}`);
  values.push(data.status);

  // Track timestamps based on status
  if (data.status === 'in_progress') {
    updates.push(`started_at = $${paramCount++}`);
    values.push(new Date());
  }

  if (data.status === 'resolved') {
    updates.push(`resolved_at = $${paramCount++}`);
    values.push(new Date());
  }

  if (data.actual_cost !== undefined) {
    updates.push(`actual_cost = $${paramCount++}`);
    values.push(data.actual_cost);
  }

  if (data.notes !== undefined) {
    updates.push(`notes = COALESCE(CONCAT(notes, '\n', $${paramCount}), $${paramCount})`);
    values.push(`Status updated to ${data.status}: ${data.notes || ''}`);
  } else {
    updates.push(`notes = COALESCE(CONCAT(notes, '\n', $${paramCount}), $${paramCount})`);
    values.push(`Status updated to ${data.status}`);
  }

  values.push(requestId);
  values.push(existing.owner_id);

  await db.query(
    `
    UPDATE maintenance_requests
    SET ${updates.join(', ')}
    WHERE id = $${paramCount++}
      AND owner_id = $${paramCount}
    `,
    values
  );

  await logAudit({
    userId: user.id,
    action: 'MAINTENANCE_STATUS_UPDATED',
    entityType: 'maintenance_request',
    entityId: requestId,
    metadata: {
      old_status: existing.status,
      new_status: data.status,
      actual_cost: data.actual_cost || null,
    },
    ipAddress,
  });

  return getMaintenanceById(user, requestId);
}

async function assignMaintenance(user, requestId, data, ipAddress) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can assign maintenance requests');
  }

  const existing = await getMaintenanceById(user, requestId);

  if (!existing) {
    throw new Error('Maintenance request not found');
  }

  // Verify the assignee exists and is a caretaker
  const assigneeResult = await db.query(
    `
    SELECT id, first_name, last_name
    FROM users
    WHERE id = $1
      AND role = 'caretaker'
      AND status = 'active'
    `,
    [data.assigned_to]
  );

  if (!assigneeResult.rows[0]) {
    throw new Error('Selected user is not an active caretaker');
  }

  // Verify the caretaker is assigned to this property
  const propertyCheck = await db.query(
    `
    SELECT id
    FROM properties
    WHERE id = $1
      AND caretaker_id = $2
      AND status = 'active'
    `,
    [existing.property_id, data.assigned_to]
  );

  if (!propertyCheck.rows[0]) {
    throw new Error('Selected caretaker is not assigned to this property');
  }

  await db.query(
    `
    UPDATE maintenance_requests
    SET 
      assigned_to = $1,
      assigned_at = CURRENT_TIMESTAMP,
      status = CASE 
        WHEN status = 'reported' THEN 'in_progress'
        ELSE status
      END
    WHERE id = $2
      AND owner_id = $3
    `,
    [data.assigned_to, requestId, existing.owner_id]
  );

  await logAudit({
    userId: user.id,
    action: 'MAINTENANCE_ASSIGNED',
    entityType: 'maintenance_request',
    entityId: requestId,
    metadata: {
      assigned_to: data.assigned_to,
      assigned_to_name: assigneeResult.rows[0].first_name + ' ' + assigneeResult.rows[0].last_name,
    },
    ipAddress,
  });

  return getMaintenanceById(user, requestId);
}

async function getMaintenanceStats(user, filters = {}) {
  const ownerId = getOwnerScope(user);
  const conditions = [];
  const params = [];

  if (ownerId) {
    params.push(ownerId);
    conditions.push(`owner_id = $${params.length}`);
  }

  if (filters.property_id) {
    await assertPropertyAccess(user, filters.property_id);
    params.push(filters.property_id);
    conditions.push(`property_id = $${params.length}`);
  }

  // If caretaker, only show stats for their assigned/property requests
  if (user.role === 'caretaker') {
    const caretakerProperties = await db.query(
      `
      SELECT id FROM properties
      WHERE caretaker_id = $1 AND status = 'active'
      `,
      [user.id]
    );
    
    const propertyIds = caretakerProperties.rows.map(r => r.id);
    if (propertyIds.length > 0) {
      const placeholders = propertyIds.map((_, i) => `$${params.length + i + 1}`).join(',');
      params.push(...propertyIds);
      conditions.push(`(assigned_to = $${params.length - propertyIds.length} OR property_id IN (${placeholders}))`);
    }
  }

  const result = await db.query(
    `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'reported' THEN 1 ELSE 0 END) AS reported,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
      SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN priority = 'urgent' THEN 1 ELSE 0 END) AS urgent,
      SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) AS high,
      SUM(CASE WHEN priority = 'medium' THEN 1 ELSE 0 END) AS medium,
      SUM(CASE WHEN priority = 'low' THEN 1 ELSE 0 END) AS low,
      COALESCE(AVG(extract(epoch FROM (resolved_at - reported_at)) / 3600), 0) AS avg_resolution_hours
    FROM maintenance_requests
    WHERE ${conditions.join(' AND ')}
    `,
    params
  );

  const stats = result.rows[0];
  return {
    total: Number(stats.total || 0),
    reported: Number(stats.reported || 0),
    in_progress: Number(stats.in_progress || 0),
    resolved: Number(stats.resolved || 0),
    cancelled: Number(stats.cancelled || 0),
    urgent: Number(stats.urgent || 0),
    high: Number(stats.high || 0),
    medium: Number(stats.medium || 0),
    low: Number(stats.low || 0),
    avg_resolution_hours: Math.round(Number(stats.avg_resolution_hours || 0)),
  };
}

async function getMaintenanceCategories() {
  return Object.entries(categoryLabels).map(([value, label]) => ({
    value,
    label,
  }));
}

module.exports = {
  listMaintenance,
  createMaintenance,
  getMaintenanceById,
  updateMaintenance,
  updateStatus,
  assignMaintenance,
  getMaintenanceStats,
  getMaintenanceCategories,
  publicMaintenance,
  categoryLabels,
  priorityLabels,
  statusLabels,
};