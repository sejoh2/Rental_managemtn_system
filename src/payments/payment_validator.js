const { z } = require('zod');

const manualPaymentSchema = z.object({
  amount: z.coerce.number().positive('Amount is required'),
  received_at: z.string().trim().optional().nullable(),
  payment_method: z.enum(['cash', 'mpesa', 'bank', 'cheque', 'other']).default('cash'),
  apply_to: z.enum(['rent_balance', 'water_bill', 'rent_deposit', 'electricity_deposit', 'water_deposit']).default('rent_balance'),
  reference: z.string().trim().max(150).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

// For auto-matched payments (from M-Pesa/Bank webhooks)
const autoPaymentSchema = z.object({
  amount: z.coerce.number().positive('Amount is required'),
  payment_method: z.enum(['mpesa_auto', 'bank_auto']),
  apply_to: z.enum(['rent_balance', 'water_bill', 'rent_deposit', 'electricity_deposit', 'water_deposit']).default('rent_balance'),
  phone: z.string().trim().min(7, 'Phone number is required for M-Pesa auto-match').max(30),
  reference: z.string().trim().max(150).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  received_at: z.string().trim().optional().nullable(),
});

const matchPaymentSchema = z.object({
  tenant_id: z.coerce.number().int().positive('Tenant is required'),
  apply_to: z.enum(['rent_balance', 'water_bill', 'rent_deposit', 'electricity_deposit', 'water_deposit']).default('rent_balance'),
  save_as_identity: z.boolean().default(false),
  notes: z.string().trim().max(500).optional().nullable(),
});

const searchTenantsSchema = z.object({
  search: z.string().trim().min(2, 'Please enter at least 2 characters to search'),
});

module.exports = {
  manualPaymentSchema,
  autoPaymentSchema,
  matchPaymentSchema,
  searchTenantsSchema,
};