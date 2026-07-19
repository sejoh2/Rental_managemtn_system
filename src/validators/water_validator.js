const { z } = require('zod');

const meterReadingSchema = z.object({
  unit_id: z.coerce.number().int().positive('Unit is required'),
  meter_number: z.string().trim().min(1, 'Meter number is required').max(100),
  current_reading: z.coerce.number().min(0, 'Current reading is required'),
  reading_date: z.string().trim().optional().nullable(),
  photo_url: z.string().trim().url().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

const approveReadingSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  notes: z.string().trim().max(500).optional().nullable(),
});

const generateBillSchema = z.object({
  property_id: z.coerce.number().int().positive().optional(),
  unit_id: z.coerce.number().int().positive().optional(),
  billing_month: z.string().trim().optional(),
});

const updateBillSchema = z.object({
  rate_per_unit: z.coerce.number().min(0).optional(),
  due_date: z.string().trim().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

const waterRulesSchema = z.object({
  water_billing_method: z.enum(['per_unit_metered', 'fixed_monthly', 'included_in_rent']).optional(),
  water_rate_per_unit: z.coerce.number().min(0).optional(),
  water_fixed_fee: z.coerce.number().min(0).optional(),
  water_billing_day: z.string().trim().max(50).optional(),
  water_reading_due_days: z.coerce.number().int().min(1).max(30).optional(),
  water_missed_reading_action: z.enum(['carry_forward', 'do_not_bill', 'estimate_average']).optional(),
});

module.exports = {
  meterReadingSchema,
  approveReadingSchema,
  generateBillSchema,
  updateBillSchema,
  waterRulesSchema,
};