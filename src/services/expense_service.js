const db = require('../config/db');
const { logAudit } = require('./audit_service');

function formatMoney(amount) {
  return `KES ${Number(amount || 0).toLocaleString('en-KE')}`;
}

function getOwnerScope(user) {
  if (user.role === 'admin') return null;
  if (user.role === 'caretaker') return user.owner_id;
  return user.id;
}

const categoryLabels = {
  repairs_maintenance: 'Repairs & maintenance',
  security: 'Security',
  garbage: 'Garbage',
  cleaning: 'Cleaning',
  utilities: 'Utilities',
  staff_wages: 'Staff wages',
  insurance: 'Insurance',
  taxes: 'Taxes',
  marketing: 'Marketing',
  other: 'Other',
};

const categoryColors = {
  repairs_maintenance: '#B3261E',
  security: '#3C5C82',
  garbage: '#6F675E',
  cleaning: '#2E7D4F',
  utilities: '#B8790E',
  staff_wages: '#C1440E',
  insurance: '#1A73E8',
  taxes: '#9334E6',
  marketing: '#E67E22',
  other: '#A39B8D',
};

function publicExpense(row) {
  return {
    id: Number(row.id),
    owner_id: Number(row.owner_id),
    property_id: Number(row.property_id),
    property_name: row.property_name,
    category: row.category,
    category_label: categoryLabels[row.category] || row.category,
    category_color: categoryColors[row.category] || '#A39B8D',
    amount: Number(row.amount),
    amount_display: formatMoney(row.amount),
    expense_date: row.expense_date,
    notes: row.notes,
    receipt_url: row.receipt_url,
    status: row.status,
    created_by: row.created_by ? Number(row.created_by) : null,
    created_by_name: row.created_by_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
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

async function getCategoryStats(user, propertyId) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT
          category,
          COUNT(*) AS count,
          SUM(amount) AS total
        FROM expenses
        WHERE owner_id = $1
          AND property_id = $2
          AND status = 'active'
        GROUP BY category
        ORDER BY total DESC
        `,
        [ownerId, propertyId]
      )
    : await db.query(
        `
        SELECT
          category,
          COUNT(*) AS count,
          SUM(amount) AS total
        FROM expenses
        WHERE property_id = $1
          AND status = 'active'
        GROUP BY category
        ORDER BY total DESC
        `,
        [propertyId]
      );

  return result.rows.map((row) => ({
    category: row.category,
    category_label: categoryLabels[row.category] || row.category,
    count: Number(row.count),
    total: Number(row.total),
    total_display: formatMoney(row.total),
  }));
}

async function calculateProfit(user, filters = {}) {
  const ownerId = getOwnerScope(user);

  // Build conditions for rent income
  const rentConditions = [`status = 'matched'`, `apply_to = 'rent_balance'`];
  const rentParams = [];

  // Build conditions for water income
  const waterConditions = [`status = 'matched'`, `apply_to = 'water_bill'`];
  const waterParams = [];

  // Build conditions for expenses
  const expenseConditions = [`e.status = 'active'`];
  const expenseParams = [];

  if (ownerId) {
    rentConditions.push(`owner_id = $${rentParams.length + 1}`);
    rentParams.push(ownerId);
    waterConditions.push(`owner_id = $${waterParams.length + 1}`);
    waterParams.push(ownerId);
    expenseConditions.push(`e.owner_id = $${expenseParams.length + 1}`);
    expenseParams.push(ownerId);
  }

  if (filters.property_id) {
    const property = await assertPropertyAccess(user, filters.property_id);
    rentConditions.push(`property_id = $${rentParams.length + 1}`);
    rentParams.push(filters.property_id);
    waterConditions.push(`property_id = $${waterParams.length + 1}`);
    waterParams.push(filters.property_id);
    expenseConditions.push(`e.property_id = $${expenseParams.length + 1}`);
    expenseParams.push(filters.property_id);
  }

  // Date filters
  if (filters.start_date) {
    rentConditions.push(`received_at >= $${rentParams.length + 1}`);
    rentParams.push(filters.start_date);
    waterConditions.push(`received_at >= $${waterParams.length + 1}`);
    waterParams.push(filters.start_date);
    expenseConditions.push(`e.expense_date >= $${expenseParams.length + 1}`);
    expenseParams.push(filters.start_date);
  }

  if (filters.end_date) {
    rentConditions.push(`received_at <= $${rentParams.length + 1}`);
    rentParams.push(filters.end_date);
    waterConditions.push(`received_at <= $${waterParams.length + 1}`);
    waterParams.push(filters.end_date);
    expenseConditions.push(`e.expense_date <= $${expenseParams.length + 1}`);
    expenseParams.push(filters.end_date);
  }

  // Get rent collected
  const rentResult = await db.query(
    `
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM payments
    WHERE ${rentConditions.join(' AND ')}
    `,
    rentParams
  );

  // Get water collected
  const waterResult = await db.query(
    `
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM payments
    WHERE ${waterConditions.join(' AND ')}
    `,
    waterParams
  );

  // Get expenses
  const expenseResult = await db.query(
    `
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM expenses e
    WHERE ${expenseConditions.join(' AND ')}
    `,
    expenseParams
  );

  const rentCollected = Number(rentResult.rows[0].total || 0);
  const waterCollected = Number(waterResult.rows[0].total || 0);
  const totalExpenses = Number(expenseResult.rows[0].total || 0);
  const totalIncome = rentCollected + waterCollected;
  const netProfit = totalIncome - totalExpenses;

  return {
    rent_collected: rentCollected,
    rent_collected_display: formatMoney(rentCollected),
    water_collected: waterCollected,
    water_collected_display: formatMoney(waterCollected),
    total_income: totalIncome,
    total_income_display: formatMoney(totalIncome),
    total_expenses: totalExpenses,
    total_expenses_display: formatMoney(totalExpenses),
    net_profit: netProfit,
    net_profit_display: formatMoney(netProfit),
    property_id: filters.property_id || null,
    start_date: filters.start_date || null,
    end_date: filters.end_date || null,
  };
}

async function listExpenses(user, filters = {}) {
  const ownerId = getOwnerScope(user);
  const conditions = [];
  const params = [];

  if (ownerId) {
    params.push(ownerId);
    conditions.push(`e.owner_id = $${params.length}`);
  }

  if (filters.property_id) {
    await assertPropertyAccess(user, filters.property_id);
    params.push(filters.property_id);
    conditions.push(`e.property_id = $${params.length}`);
  }

  if (filters.category) {
    params.push(filters.category);
    conditions.push(`e.category = $${params.length}`);
  }

  if (filters.start_date) {
    params.push(filters.start_date);
    conditions.push(`e.expense_date >= $${params.length}`);
  }

  if (filters.end_date) {
    params.push(filters.end_date);
    conditions.push(`e.expense_date <= $${params.length}`);
  }

  if (filters.status && filters.status !== 'all') {
    params.push(filters.status);
    conditions.push(`e.status = $${params.length}`);
  } else {
    conditions.push(`e.status = 'active'`);
  }

  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const result = await db.query(
    `
    SELECT
      e.*,
      p.name AS property_name,
      CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
    FROM expenses e
    INNER JOIN properties p ON p.id = e.property_id
    LEFT JOIN users u ON u.id = e.created_by
    WHERE ${conditions.join(' AND ')}
    ORDER BY e.expense_date DESC, e.created_at DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
    `,
    [...params, limit, offset]
  );

  // Get total count
  const countResult = await db.query(
    `
    SELECT COUNT(*) AS total
    FROM expenses e
    WHERE ${conditions.join(' AND ')}
    `,
    params
  );

  const expenses = result.rows.map(publicExpense);
  const total = Number(countResult.rows[0].total || 0);

  return {
    expenses,
    pagination: {
      total,
      limit,
      offset,
      has_more: offset + limit < total,
    },
  };
}

async function createExpense(user, data, ipAddress) {
  if (!['admin', 'owner', 'caretaker'].includes(user.role)) {
    throw new Error('You are not allowed to create expenses');
  }

  const property = await assertPropertyAccess(user, data.property_id);

  const result = await db.query(
    `
    INSERT INTO expenses (
      owner_id,
      property_id,
      category,
      amount,
      expense_date,
      notes,
      receipt_url,
      created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
    `,
    [
      property.owner_id,
      data.property_id,
      data.category,
      data.amount,
      data.expense_date || new Date(),
      data.notes || null,
      data.receipt_url || null,
      user.id,
    ]
  );

  await logAudit({
    userId: user.id,
    action: 'EXPENSE_CREATED',
    entityType: 'expense',
    entityId: result.rows[0].id,
    metadata: {
      property_id: data.property_id,
      property_name: property.name,
      category: data.category,
      amount: data.amount,
    },
    ipAddress,
  });

  return getExpenseById(user, result.rows[0].id);
}

async function getExpenseById(user, expenseId) {
  const ownerId = getOwnerScope(user);

  const result = ownerId
    ? await db.query(
        `
        SELECT
          e.*,
          p.name AS property_name,
          CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
        FROM expenses e
        INNER JOIN properties p ON p.id = e.property_id
        LEFT JOIN users u ON u.id = e.created_by
        WHERE e.id = $1
          AND e.owner_id = $2
        `,
        [expenseId, ownerId]
      )
    : await db.query(
        `
        SELECT
          e.*,
          p.name AS property_name,
          CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
        FROM expenses e
        INNER JOIN properties p ON p.id = e.property_id
        LEFT JOIN users u ON u.id = e.created_by
        WHERE e.id = $1
        `,
        [expenseId]
      );

  return result.rows[0] ? publicExpense(result.rows[0]) : null;
}

async function updateExpense(user, expenseId, data, ipAddress) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can update expenses');
  }

  const existing = await getExpenseById(user, expenseId);

  if (!existing) {
    throw new Error('Expense not found');
  }

  // Verify property access if property_id is being changed
  if (data.property_id && data.property_id !== existing.property_id) {
    await assertPropertyAccess(user, data.property_id);
  }

  const updates = [];
  const values = [];
  let paramCount = 1;

  if (data.property_id !== undefined) {
    updates.push(`property_id = $${paramCount++}`);
    values.push(data.property_id);
  }

  if (data.category !== undefined) {
    updates.push(`category = $${paramCount++}`);
    values.push(data.category);
  }

  if (data.amount !== undefined) {
    updates.push(`amount = $${paramCount++}`);
    values.push(data.amount);
  }

  if (data.expense_date !== undefined) {
    updates.push(`expense_date = $${paramCount++}`);
    values.push(data.expense_date);
  }

  if (data.notes !== undefined) {
    updates.push(`notes = $${paramCount++}`);
    values.push(data.notes);
  }

  if (data.receipt_url !== undefined) {
    updates.push(`receipt_url = $${paramCount++}`);
    values.push(data.receipt_url);
  }

  if (data.status !== undefined) {
    updates.push(`status = $${paramCount++}`);
    values.push(data.status);
  }

  if (updates.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(expenseId);
  values.push(existing.owner_id);

  await db.query(
    `
    UPDATE expenses
    SET ${updates.join(', ')}
    WHERE id = $${paramCount++}
      AND owner_id = $${paramCount}
    `,
    values
  );

  await logAudit({
    userId: user.id,
    action: 'EXPENSE_UPDATED',
    entityType: 'expense',
    entityId: expenseId,
    metadata: data,
    ipAddress,
  });

  return getExpenseById(user, expenseId);
}

async function deleteExpense(user, expenseId, ipAddress) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw new Error('Only owners can delete expenses');
  }

  const existing = await getExpenseById(user, expenseId);

  if (!existing) {
    throw new Error('Expense not found');
  }

  await db.query(
    `
    UPDATE expenses
    SET status = 'archived'
    WHERE id = $1
      AND owner_id = $2
    `,
    [expenseId, existing.owner_id]
  );

  await logAudit({
    userId: user.id,
    action: 'EXPENSE_DELETED',
    entityType: 'expense',
    entityId: expenseId,
    metadata: {
      property_id: existing.property_id,
      amount: existing.amount,
      category: existing.category,
    },
    ipAddress,
  });
}

async function getExpenseCategories() {
  return Object.entries(categoryLabels).map(([value, label]) => ({
    value,
    label,
    color: categoryColors[value] || '#A39B8D',
  }));
}

async function getExpenseStats(user, filters = {}) {
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

  if (filters.start_date) {
    params.push(filters.start_date);
    conditions.push(`expense_date >= $${params.length}`);
  }

  if (filters.end_date) {
    params.push(filters.end_date);
    conditions.push(`expense_date <= $${params.length}`);
  }

  conditions.push(`status = 'active'`);

  const result = await db.query(
    `
    SELECT
      COUNT(*) AS total_count,
      COALESCE(SUM(amount), 0) AS total_amount,
      COALESCE(AVG(amount), 0) AS average_amount,
      MIN(expense_date) AS first_expense,
      MAX(expense_date) AS last_expense
    FROM expenses
    WHERE ${conditions.join(' AND ')}
    `,
    params
  );

  const stats = result.rows[0];
  return {
    total_count: Number(stats.total_count || 0),
    total_amount: Number(stats.total_amount || 0),
    total_amount_display: formatMoney(stats.total_amount || 0),
    average_amount: Number(stats.average_amount || 0),
    average_amount_display: formatMoney(stats.average_amount || 0),
    first_expense: stats.first_expense,
    last_expense: stats.last_expense,
  };
}

module.exports = {
  listExpenses,
  createExpense,
  getExpenseById,
  updateExpense,
  deleteExpense,
  getCategoryStats,
  getExpenseCategories,
  getExpenseStats,
  calculateProfit,
  categoryLabels,
  categoryColors,
};