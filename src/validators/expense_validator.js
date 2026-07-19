const { z } = require('zod');

const expenseCategorySchema = z.enum([
  'repairs_maintenance',
  'security',
  'garbage',
  'cleaning',
  'utilities',
  'staff_wages',
  'insurance',
  'taxes',
  'marketing',
  'other',
]);

const createExpenseSchema = z.object({
  property_id: z.coerce.number().int().positive('Property is required'),
  category: expenseCategorySchema,
  amount: z.coerce.number().positive('Amount is required'),
  expense_date: z.string().trim().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  receipt_url: z.string().trim().url().optional().nullable(),
});

const updateExpenseSchema = createExpenseSchema.partial();

const listExpensesQuerySchema = z.object({
  property_id: z.coerce.number().int().positive().optional(),
  category: expenseCategorySchema.optional(),
  start_date: z.string().trim().optional(),
  end_date: z.string().trim().optional(),
  status: z.enum(['all', 'active', 'archived']).default('active').optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const profitSummarySchema = z.object({
  property_id: z.coerce.number().int().positive().optional(),
  start_date: z.string().trim().optional(),
  end_date: z.string().trim().optional(),
});

module.exports = {
  expenseCategorySchema,
  createExpenseSchema,
  updateExpenseSchema,
  listExpensesQuerySchema,
  profitSummarySchema,
};