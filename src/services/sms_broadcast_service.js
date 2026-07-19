const db = require('../config/db');
const { logAudit } = require('./audit_service');
const smsProvider = require('../utils/sms_provider');

const SMS_COST_PER_MESSAGE = 1.50; // KES per SMS (adjust based on provider)

function getOwnerScope(user) {
  if (user.role === 'admin') return null;
  if (user.role === 'caretaker') return user.owner_id;
  return user.id;
}

function formatMoney(amount) {
  return `KES ${Number(amount || 0).toLocaleString('en-KE')}`;
}

function publicTemplate(row) {
  return {
    id: Number(row.id),
    owner_id: Number(row.owner_id),
    name: row.name,
    content: row.content,
    is_default: row.is_default,
    created_by: row.created_by ? Number(row.created_by) : null,
    created_by_name: row.created_by_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function publicBroadcast(row) {
  return {
    id: Number(row.id),
    owner_id: Number(row.owner_id),
    template_id: row.template_id ? Number(row.template_id) : null,
    template_name: row.template_name,
    name: row.name,
    message: row.message,
    recipients_type: row.recipients_type,
    recipients_type_label: getRecipientsTypeLabel(row.recipients_type),
    property_id: row.property_id ? Number(row.property_id) : null,
    property_name: row.property_name,
    recipient_ids: row.recipient_ids || [],
    status: row.status,
    status_label: getBroadcastStatusLabel(row.status),
    total_recipients: Number(row.total_recipients || 0),
    total_sent: Number(row.total_sent || 0),
    total_delivered: Number(row.total_delivered || 0),
    total_failed: Number(row.total_failed || 0),
    estimated_cost: Number(row.estimated_cost || 0),
    estimated_cost_display: formatMoney(row.estimated_cost || 0),
    actual_cost: Number(row.actual_cost || 0),
    actual_cost_display: formatMoney(row.actual_cost || 0),
    scheduled_at: row.scheduled_at,
    sent_at: row.sent_at,
    completed_at: row.completed_at,
    created_by: row.created_by ? Number(row.created_by) : null,
    created_by_name: row.created_by_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function publicMessage(row) {
  return {
    id: Number(row.id),
    owner_id: Number(row.owner_id),
    broadcast_id: row.broadcast_id ? Number(row.broadcast_id) : null,
    broadcast_name: row.broadcast_name,
    tenant_id: row.tenant_id ? Number(row.tenant_id) : null,
    tenant_name: row.tenant_name,
    recipient_phone: row.recipient_phone,
    message: row.message,
    status: row.status,
    status_label: getMessageStatusLabel(row.status),
    status_reason: row.status_reason,
    cost: Number(row.cost || 0),
    cost_display: formatMoney(row.cost || 0),
    scheduled_at: row.scheduled_at,
    sent_at: row.sent_at,
    delivered_at: row.delivered_at,
    failed_at: row.failed_at,
    provider_message_id: row.provider_message_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getRecipientsTypeLabel(type) {
  const labels = {
    all: 'All active tenants',
    property: 'Tenants in one property',
    arrears: 'Tenants with arrears',
    credit: 'Tenants with credit balance',
    specific: 'Specific tenants',
  };
  return labels[type] || type;
}

function getBroadcastStatusLabel(status) {
  const labels = {
    draft: 'Draft',
    scheduled: 'Scheduled',
    sending: 'Sending...',
    sent: 'Sent',
    cancelled: 'Cancelled',
    failed: 'Failed',
  };
  return labels[status] || status;
}

function getMessageStatusLabel(status) {
  const labels = {
    pending: 'Pending',
    sent: 'Sent',
    delivered: 'Delivered',
    failed: 'Failed',
    scheduled: 'Scheduled',
    cancelled: 'Cancelled',
  };
  return labels[status] || status;
}

// ============================================================
// TEMPLATE FUNCTIONS
// ============================================================

async function listTemplates(user) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT
          t.*,
          CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
        FROM sms_templates t
        LEFT JOIN users u ON u.id = t.created_by
        WHERE t.owner_id = $1
        ORDER BY t.is_default DESC, t.created_at DESC
        `,
        [ownerId]
      )
    : await db.query(
        `
        SELECT
          t.*,
          CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
        FROM sms_templates t
        LEFT JOIN users u ON u.id = t.created_by
        ORDER BY t.is_default DESC, t.created_at DESC
        `
      );

  return result.rows.map(publicTemplate);
}

async function getTemplateById(user, templateId) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT
          t.*,
          CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
        FROM sms_templates t
        LEFT JOIN users u ON u.id = t.created_by
        WHERE t.id = $1
          AND t.owner_id = $2
        `,
        [templateId, ownerId]
      )
    : await db.query(
        `
        SELECT
          t.*,
          CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
        FROM sms_templates t
        LEFT JOIN users u ON u.id = t.created_by
        WHERE t.id = $1
        `,
        [templateId]
      );

  return result.rows[0] ? publicTemplate(result.rows[0]) : null;
}

async function createTemplate(user, data, ipAddress) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can create SMS templates');
  }

  const ownerId = getOwnerScope(user);

  const result = await db.query(
    `
    INSERT INTO sms_templates (
      owner_id,
      name,
      content,
      is_default,
      created_by
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
    `,
    [
      ownerId || user.id,
      data.name,
      data.content,
      data.is_default || false,
      user.id,
    ]
  );

  await logAudit({
    userId: user.id,
    action: 'SMS_TEMPLATE_CREATED',
    entityType: 'sms_template',
    entityId: result.rows[0].id,
    metadata: {
      name: data.name,
      is_default: data.is_default,
    },
    ipAddress,
  });

  return getTemplateById(user, result.rows[0].id);
}

async function updateTemplate(user, templateId, data, ipAddress) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can update SMS templates');
  }

  const existing = await getTemplateById(user, templateId);

  if (!existing) {
    throw new Error('Template not found');
  }

  const updates = [];
  const values = [];
  let paramCount = 1;

  if (data.name !== undefined) {
    updates.push(`name = $${paramCount++}`);
    values.push(data.name);
  }

  if (data.content !== undefined) {
    updates.push(`content = $${paramCount++}`);
    values.push(data.content);
  }

  if (data.is_default !== undefined) {
    updates.push(`is_default = $${paramCount++}`);
    values.push(data.is_default);
  }

  if (updates.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(templateId);
  values.push(existing.owner_id);

  await db.query(
    `
    UPDATE sms_templates
    SET ${updates.join(', ')}
    WHERE id = $${paramCount++}
      AND owner_id = $${paramCount}
    `,
    values
  );

  await logAudit({
    userId: user.id,
    action: 'SMS_TEMPLATE_UPDATED',
    entityType: 'sms_template',
    entityId: templateId,
    metadata: data,
    ipAddress,
  });

  return getTemplateById(user, templateId);
}

async function deleteTemplate(user, templateId, ipAddress) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can delete SMS templates');
  }

  const existing = await getTemplateById(user, templateId);

  if (!existing) {
    throw new Error('Template not found');
  }

  if (existing.is_default) {
    throw new Error('Cannot delete a default template');
  }

  await db.query(
    `
    DELETE FROM sms_templates
    WHERE id = $1
      AND owner_id = $2
    `,
    [templateId, existing.owner_id]
  );

  await logAudit({
    userId: user.id,
    action: 'SMS_TEMPLATE_DELETED',
    entityType: 'sms_template',
    entityId: templateId,
    metadata: {
      name: existing.name,
    },
    ipAddress,
  });
}

// ============================================================
// BROADCAST FUNCTIONS
// ============================================================

async function getRecipients(user, type, propertyId, recipientIds) {
  const ownerId = getOwnerScope(user);
  let conditions = [`t.status != 'archived'`];
  const params = [];

  if (ownerId) {
    params.push(ownerId);
    conditions.push(`t.owner_id = $${params.length}`);
  }

  if (type === 'property' && propertyId) {
    params.push(propertyId);
    conditions.push(`t.property_id = $${params.length}`);
  }

  if (type === 'arrears') {
    // Tenants with rent balance > 0
    conditions.push(`(t.monthly_rent - COALESCE(
      (SELECT SUM(amount) FROM payments WHERE tenant_id = t.id AND status = 'matched' AND apply_to = 'rent_balance'), 0
    )) > 0`);
  }

  if (type === 'credit') {
    // Tenants with rent balance < 0 (credit)
    conditions.push(`(t.monthly_rent - COALESCE(
      (SELECT SUM(amount) FROM payments WHERE tenant_id = t.id AND status = 'matched' AND apply_to = 'rent_balance'), 0
    )) < 0`);
  }

  if (type === 'specific' && recipientIds && recipientIds.length > 0) {
    const placeholders = recipientIds.map((_, i) => `$${params.length + i + 1}`).join(',');
    params.push(...recipientIds);
    conditions.push(`t.id IN (${placeholders})`);
  }

  const result = await db.query(
    `
    SELECT
      t.id,
      t.full_name,
      t.phone,
      t.monthly_rent,
      u.unit_number,
      p.name AS property_name,
      COALESCE(
        (SELECT SUM(amount) FROM payments WHERE tenant_id = t.id AND status = 'matched' AND apply_to = 'rent_balance'), 0
      ) AS rent_paid,
      t.monthly_rent - COALESCE(
        (SELECT SUM(amount) FROM payments WHERE tenant_id = t.id AND status = 'matched' AND apply_to = 'rent_balance'), 0
      ) AS balance
    FROM tenants t
    INNER JOIN units u ON u.id = t.unit_id
    INNER JOIN properties p ON p.id = t.property_id
    WHERE ${conditions.join(' AND ')}
    `,
    params
  );

  return result.rows;
}

async function createBroadcast(user, data, ipAddress) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can create SMS broadcasts');
  }

  const ownerId = getOwnerScope(user);

  // Get recipients
  const recipients = await getRecipients(
    user,
    data.recipients_type,
    data.property_id,
    data.recipient_ids
  );

  const totalRecipients = recipients.length;

  if (totalRecipients === 0) {
    throw new Error('No recipients found for this broadcast');
  }

  // Calculate estimated cost
  const estimatedCost = totalRecipients * SMS_COST_PER_MESSAGE;

  // Check if scheduled
  const isScheduled = data.scheduled_at && new Date(data.scheduled_at) > new Date();
  const status = isScheduled ? 'scheduled' : 'draft';

  const result = await db.query(
    `
    INSERT INTO sms_broadcasts (
      owner_id,
      template_id,
      name,
      message,
      recipients_type,
      property_id,
      recipient_ids,
      status,
      total_recipients,
      estimated_cost,
      scheduled_at,
      created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
    `,
    [
      ownerId || user.id,
      data.template_id || null,
      data.name,
      data.message,
      data.recipients_type,
      data.property_id || null,
      JSON.stringify(data.recipient_ids || []),
      status,
      totalRecipients,
      estimatedCost,
      data.scheduled_at || null,
      user.id,
    ]
  );

  await logAudit({
    userId: user.id,
    action: isScheduled ? 'SMS_BROADCAST_SCHEDULED' : 'SMS_BROADCAST_CREATED',
    entityType: 'sms_broadcast',
    entityId: result.rows[0].id,
    metadata: {
      name: data.name,
      recipients_type: data.recipients_type,
      total_recipients: totalRecipients,
      scheduled_at: data.scheduled_at,
    },
    ipAddress,
  });

  // If not scheduled and status is draft, send immediately
  if (!isScheduled) {
    // Send the broadcast in the background
    // Note: In production, this should be queued using a job queue
    setImmediate(() => {
      sendBroadcast(user, result.rows[0].id);
    });
  }

  return getBroadcastById(user, result.rows[0].id);
}

async function sendBroadcast(user, broadcastId) {
  try {
    const broadcast = await db.query(
      `
      SELECT *
      FROM sms_broadcasts
      WHERE id = $1 AND status IN ('draft', 'scheduled')
      `,
      [broadcastId]
    );

    if (!broadcast.rows[0]) {
      throw new Error('Broadcast not found or already sent');
    }

    const data = broadcast.rows[0];

    // Update status to sending
    await db.query(
      `
      UPDATE sms_broadcasts
      SET status = 'sending', sent_at = CURRENT_TIMESTAMP
      WHERE id = $1
      `,
      [broadcastId]
    );

    // Get recipients
    const recipients = await getRecipients(
      user,
      data.recipients_type,
      data.property_id,
      data.recipient_ids
    );

    let sentCount = 0;
    let deliveredCount = 0;
    let failedCount = 0;
    let totalCost = 0;

    // Send messages
    for (const recipient of recipients) {
      try {
        // Replace placeholders in message
        const message = replacePlaceholders(data.message, {
          name: recipient.full_name,
          house: recipient.unit_number,
          property: recipient.property_name,
          rent: formatMoney(recipient.monthly_rent || 0),
          balance: formatMoney(recipient.balance || 0),
          month: new Date().toLocaleString('en', { month: 'long' }),
          due_date: '5th of every month', // TODO: Get from property
        });

        // Send SMS via Africa's Talking
        const result = await smsProvider.sendSms({
          phone: recipient.phone,
          message: message,
        });

        // Store message record
        await db.query(
          `
          INSERT INTO sms_messages (
            owner_id,
            broadcast_id,
            tenant_id,
            recipient_phone,
            message,
            status,
            cost,
            sent_at,
            provider_message_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
          [
            data.owner_id,
            broadcastId,
            recipient.id,
            recipient.phone,
            message,
            result.status === 'sent' ? 'sent' : 'failed',
            result.cost || SMS_COST_PER_MESSAGE,
            new Date(),
            result.messageId || null,
          ]
        );

        sentCount++;
        totalCost += result.cost || SMS_COST_PER_MESSAGE;

        if (result.status === 'delivered') {
          deliveredCount++;
        }
      } catch (error) {
        // Log failed message
        await db.query(
          `
          INSERT INTO sms_messages (
            owner_id,
            broadcast_id,
            tenant_id,
            recipient_phone,
            message,
            status,
            status_reason,
            failed_at
          )
          VALUES ($1, $2, $3, $4, $5, 'failed', $6, CURRENT_TIMESTAMP)
          `,
          [
            data.owner_id,
            broadcastId,
            recipient.id,
            recipient.phone,
            message,
            error.message,
          ]
        );
        failedCount++;
      }
    }

    // Update broadcast with final stats
    await db.query(
      `
      UPDATE sms_broadcasts
      SET
        status = 'sent',
        total_sent = $1,
        total_delivered = $2,
        total_failed = $3,
        actual_cost = $4,
        completed_at = CURRENT_TIMESTAMP
      WHERE id = $5
      `,
      [sentCount, deliveredCount, failedCount, totalCost, broadcastId]
    );

    await logAudit({
      userId: user.id,
      action: 'SMS_BROADCAST_SENT',
      entityType: 'sms_broadcast',
      entityId: broadcastId,
      metadata: {
        name: data.name,
        total_sent: sentCount,
        total_failed: failedCount,
        actual_cost: totalCost,
      },
      ipAddress: null,
    });

    return {
      success: true,
      sent: sentCount,
      failed: failedCount,
    };
  } catch (error) {
    await db.query(
      `
      UPDATE sms_broadcasts
      SET status = 'failed'
      WHERE id = $1
      `,
      [broadcastId]
    );
    throw error;
  }
}

function replacePlaceholders(message, data) {
  const placeholders = {
    '{name}': data.name || '',
    '{house}': data.house || '',
    '{property}': data.property || '',
    '{rent}': data.rent || '',
    '{balance}': data.balance || '',
    '{amount}': data.amount || '',
    '{month}': data.month || '',
    '{due_date}': data.due_date || '',
    '{days_overdue}': data.days_overdue || '',
  };

  let result = message;
  for (const [key, value] of Object.entries(placeholders)) {
    result = result.replace(new RegExp(key, 'g'), value);
  }
  return result;
}

async function getBroadcastById(user, broadcastId) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT
          b.*,
          t.name AS template_name,
          p.name AS property_name,
          CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
        FROM sms_broadcasts b
        LEFT JOIN sms_templates t ON t.id = b.template_id
        LEFT JOIN properties p ON p.id = b.property_id
        LEFT JOIN users u ON u.id = b.created_by
        WHERE b.id = $1
          AND b.owner_id = $2
        `,
        [broadcastId, ownerId]
      )
    : await db.query(
        `
        SELECT
          b.*,
          t.name AS template_name,
          p.name AS property_name,
          CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
        FROM sms_broadcasts b
        LEFT JOIN sms_templates t ON t.id = b.template_id
        LEFT JOIN properties p ON p.id = b.property_id
        LEFT JOIN users u ON u.id = b.created_by
        WHERE b.id = $1
        `,
        [broadcastId]
      );

  return result.rows[0] ? publicBroadcast(result.rows[0]) : null;
}

async function listBroadcasts(user, filters = {}) {
  const ownerId = getOwnerScope(user);
  const conditions = [];
  const params = [];

  if (ownerId) {
    params.push(ownerId);
    conditions.push(`b.owner_id = $${params.length}`);
  }

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`b.status = $${params.length}`);
  }

  if (filters.start_date) {
    params.push(filters.start_date);
    conditions.push(`b.created_at >= $${params.length}`);
  }

  if (filters.end_date) {
    params.push(filters.end_date);
    conditions.push(`b.created_at <= $${params.length}`);
  }

  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const result = await db.query(
    `
    SELECT
      b.*,
      t.name AS template_name,
      p.name AS property_name,
      CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
    FROM sms_broadcasts b
    LEFT JOIN sms_templates t ON t.id = b.template_id
    LEFT JOIN properties p ON p.id = b.property_id
    LEFT JOIN users u ON u.id = b.created_by
    WHERE ${conditions.join(' AND ')}
    ORDER BY b.created_at DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
    `,
    [...params, limit, offset]
  );

  const countResult = await db.query(
    `
    SELECT COUNT(*) AS total
    FROM sms_broadcasts b
    WHERE ${conditions.join(' AND ')}
    `,
    params
  );

  const broadcasts = result.rows.map(publicBroadcast);
  const total = Number(countResult.rows[0].total || 0);

  return {
    broadcasts,
    pagination: {
      total,
      limit,
      offset,
      has_more: offset + limit < total,
    },
  };
}

async function cancelBroadcast(user, broadcastId, ipAddress) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can cancel broadcasts');
  }

  const existing = await getBroadcastById(user, broadcastId);

  if (!existing) {
    throw new Error('Broadcast not found');
  }

  if (existing.status === 'sent' || existing.status === 'sending') {
    throw new Error('Cannot cancel a broadcast that is already sent or sending');
  }

  await db.query(
    `
    UPDATE sms_broadcasts
    SET status = 'cancelled'
    WHERE id = $1
      AND owner_id = $2
    `,
    [broadcastId, existing.owner_id]
  );

  await logAudit({
    userId: user.id,
    action: 'SMS_BROADCAST_CANCELLED',
    entityType: 'sms_broadcast',
    entityId: broadcastId,
    metadata: {
      name: existing.name,
    },
    ipAddress,
  });
}

// ============================================================
// MESSAGE FUNCTIONS
// ============================================================

async function listMessages(user, filters = {}) {
  const ownerId = getOwnerScope(user);
  const conditions = [];
  const params = [];

  if (ownerId) {
    params.push(ownerId);
    conditions.push(`m.owner_id = $${params.length}`);
  }

  if (filters.broadcast_id) {
    params.push(filters.broadcast_id);
    conditions.push(`m.broadcast_id = $${params.length}`);
  }

  if (filters.tenant_id) {
    params.push(filters.tenant_id);
    conditions.push(`m.tenant_id = $${params.length}`);
  }

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`m.status = $${params.length}`);
  }

  if (filters.start_date) {
    params.push(filters.start_date);
    conditions.push(`m.created_at >= $${params.length}`);
  }

  if (filters.end_date) {
    params.push(filters.end_date);
    conditions.push(`m.created_at <= $${params.length}`);
  }

  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const result = await db.query(
    `
    SELECT
      m.*,
      b.name AS broadcast_name,
      t.full_name AS tenant_name
    FROM sms_messages m
    LEFT JOIN sms_broadcasts b ON b.id = m.broadcast_id
    LEFT JOIN tenants t ON t.id = m.tenant_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY m.created_at DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
    `,
    [...params, limit, offset]
  );

  const countResult = await db.query(
    `
    SELECT COUNT(*) AS total
    FROM sms_messages m
    WHERE ${conditions.join(' AND ')}
    `,
    params
  );

  const messages = result.rows.map(publicMessage);
  const total = Number(countResult.rows[0].total || 0);

  return {
    messages,
    pagination: {
      total,
      limit,
      offset,
      has_more: offset + limit < total,
    },
  };
}

// ============================================================
// STATS FUNCTIONS
// ============================================================

async function getSmsStats(user) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT
          (SELECT COUNT(*) FROM sms_messages WHERE owner_id = $1 AND created_at >= date_trunc('month', CURRENT_DATE)) AS sent_this_month,
          (SELECT COALESCE(SUM(cost), 0) FROM sms_messages WHERE owner_id = $1 AND created_at >= date_trunc('month', CURRENT_DATE)) AS cost_this_month,
          (SELECT COUNT(*) FROM sms_messages WHERE owner_id = $1 AND status = 'delivered') AS delivered,
          (SELECT COUNT(*) FROM sms_messages WHERE owner_id = $1 AND status = 'failed') AS failed,
          (SELECT COUNT(*) FROM sms_messages WHERE owner_id = $1 AND status = 'pending') AS pending,
          (SELECT COUNT(*) FROM sms_broadcasts WHERE owner_id = $1 AND status = 'scheduled' AND scheduled_at > CURRENT_TIMESTAMP) AS scheduled,
          (SELECT COUNT(*) FROM sms_messages WHERE owner_id = $1 AND status = 'scheduled') AS scheduled_messages
        `,
        [ownerId]
      )
    : await db.query(
        `
        SELECT
          (SELECT COUNT(*) FROM sms_messages WHERE created_at >= date_trunc('month', CURRENT_DATE)) AS sent_this_month,
          (SELECT COALESCE(SUM(cost), 0) FROM sms_messages WHERE created_at >= date_trunc('month', CURRENT_DATE)) AS cost_this_month,
          (SELECT COUNT(*) FROM sms_messages WHERE status = 'delivered') AS delivered,
          (SELECT COUNT(*) FROM sms_messages WHERE status = 'failed') AS failed,
          (SELECT COUNT(*) FROM sms_messages WHERE status = 'pending') AS pending,
          (SELECT COUNT(*) FROM sms_broadcasts WHERE status = 'scheduled' AND scheduled_at > CURRENT_TIMESTAMP) AS scheduled,
          (SELECT COUNT(*) FROM sms_messages WHERE status = 'scheduled') AS scheduled_messages
        `
      );

  const stats = result.rows[0];
  const totalMessages = Number(stats.delivered || 0) + Number(stats.failed || 0) + Number(stats.pending || 0);
  const deliveryRate = totalMessages > 0 ? (Number(stats.delivered || 0) / totalMessages * 100) : 0;

  return {
    sent_this_month: Number(stats.sent_this_month || 0),
    cost_this_month: Number(stats.cost_this_month || 0),
    cost_this_month_display: formatMoney(stats.cost_this_month || 0),
    delivered: Number(stats.delivered || 0),
    failed: Number(stats.failed || 0),
    pending: Number(stats.pending || 0),
    scheduled: Number(stats.scheduled || 0),
    scheduled_messages: Number(stats.scheduled_messages || 0),
    total_messages: totalMessages,
    delivery_rate: Math.round(deliveryRate * 10) / 10,
  };
}

// ============================================================
// WEBHOOK FUNCTIONS (Delivery Status Updates)
// ============================================================

async function handleDeliveryWebhook(data, ipAddress) {
  // Find the message by provider message ID
  const message = await db.query(
    `
    SELECT id, status
    FROM sms_messages
    WHERE provider_message_id = $1
    `,
    [data.id]
  );

  if (!message.rows[0]) {
    throw new Error('Message not found');
  }

  const messageId = message.rows[0].id;
  const currentStatus = message.rows[0].status;

  // Only update if not already delivered or failed
  if (currentStatus === 'delivered' || currentStatus === 'failed') {
    return { success: true, message: 'Already processed' };
  }

  let status = data.status;
  let updateFields = [];
  const values = [];
  let paramCount = 1;

  if (data.status === 'delivered') {
    updateFields.push(`status = $${paramCount++}`);
    values.push('delivered');
    updateFields.push(`delivered_at = $${paramCount++}`);
    values.push(new Date());
  } else if (data.status === 'failed') {
    updateFields.push(`status = $${paramCount++}`);
    values.push('failed');
    updateFields.push(`failed_at = $${paramCount++}`);
    values.push(new Date());
    if (data.failureReason) {
      updateFields.push(`status_reason = $${paramCount++}`);
      values.push(data.failureReason);
    }
  } else {
    updateFields.push(`status = $${paramCount++}`);
    values.push(data.status);
  }

  if (data.cost !== undefined) {
    updateFields.push(`cost = $${paramCount++}`);
    values.push(data.cost);
  }

  values.push(messageId);

  await db.query(
    `
    UPDATE sms_messages
    SET ${updateFields.join(', ')}
    WHERE id = $${paramCount}
    `,
    values
  );

  // Update broadcast stats if this message is part of a broadcast
  const broadcastInfo = await db.query(
    `
    SELECT broadcast_id, owner_id
    FROM sms_messages
    WHERE id = $1
    `,
    [messageId]
  );

  if (broadcastInfo.rows[0]?.broadcast_id) {
    const broadcastId = broadcastInfo.rows[0].broadcast_id;
    await updateBroadcastStats(broadcastId);
  }

  return { success: true, message: 'Delivery status updated' };
}

async function updateBroadcastStats(broadcastId) {
  // Get counts from messages
  const counts = await db.query(
    `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM sms_messages
    WHERE broadcast_id = $1
    `,
    [broadcastId]
  );

  const stats = counts.rows[0];

  await db.query(
    `
    UPDATE sms_broadcasts
    SET
      total_sent = $1,
      total_delivered = $2,
      total_failed = $3
    WHERE id = $4
    `,
    [
      Number(stats.total || 0),
      Number(stats.delivered || 0),
      Number(stats.failed || 0),
      broadcastId,
    ]
  );
}

module.exports = {
  listTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listBroadcasts,
  getBroadcastById,
  createBroadcast,
  sendBroadcast,
  cancelBroadcast,
  listMessages,
  getSmsStats,
  handleDeliveryWebhook,
  replacePlaceholders,
};