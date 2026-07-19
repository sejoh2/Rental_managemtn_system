const db = require('../config/db');

async function initExpenseTables() {
  // Expenses table
  await db.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id BIGSERIAL PRIMARY KEY,
      owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      category VARCHAR(50) NOT NULL,
      amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
      expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
      notes TEXT,
      receipt_url VARCHAR(255),
      status VARCHAR(30) NOT NULL DEFAULT 'active',
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Add category check constraint
  await db.query(`
    ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_category_check;
  `);

  await db.query(`
    ALTER TABLE expenses
    ADD CONSTRAINT expenses_category_check
    CHECK (category IN (
      'repairs_maintenance',
      'security',
      'garbage',
      'cleaning',
      'utilities',
      'staff_wages',
      'insurance',
      'taxes',
      'marketing',
      'other'
    ));
  `);

  // Add status check constraint
  await db.query(`
    ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_status_check;
  `);

  await db.query(`
    ALTER TABLE expenses
    ADD CONSTRAINT expenses_status_check
    CHECK (status IN ('active', 'archived'));
  `);

  // Indexes for performance
  await db.query(`CREATE INDEX IF NOT EXISTS idx_expenses_owner_id ON expenses(owner_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_expenses_property_id ON expenses(property_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON expenses(expense_date);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);`);

  // Trigger for updated_at
  await db.query(`
    DROP TRIGGER IF EXISTS update_expenses_updated_at ON expenses;
  `);

  await db.query(`
    CREATE TRIGGER update_expenses_updated_at
    BEFORE UPDATE ON expenses
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  console.log('Expense tables initialized successfully');
}

module.exports = initExpenseTables;