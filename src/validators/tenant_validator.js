const { z } = require('zod');

const DEFAULT_WATER_DEPOSIT = Number(process.env.DEFAULT_WATER_DEPOSIT_AMOUNT) || 2000;
const DEFAULT_ELECTRICITY_DEPOSIT = Number(process.env.DEFAULT_ELECTRICITY_DEPOSIT_AMOUNT) || 0;

const tenantStatusSchema = z.enum(['active', 'moving_out', 'archived']);

const createTenantSchema = z.object({
  property_id: z.coerce.number().int().positive('Property is required'),
  unit_id: z.coerce.number().int().positive('House / unit is required'),
  full_name: z.string().trim().min(2, 'Full name is required').max(200),
  phone: z.string().trim().min(7, 'Phone number is required').max(30),
  id_number: z.string().trim().max(100).optional().nullable(),
  move_in_date: z.string().trim().optional().nullable(),

  monthly_rent: z.coerce.number().min(0).default(0),
  rent_paid: z.coerce.number().min(0).optional().default(0),

  // Rent deposit - will be set to monthly_rent by default in service
  rent_deposit_amount: z.coerce.number().min(0).optional(),
  rent_deposit_paid: z.coerce.number().min(0).optional().default(0),

  electricity_deposit_amount: z.coerce.number().min(0).optional().default(DEFAULT_ELECTRICITY_DEPOSIT),
  electricity_deposit_paid: z.coerce.number().min(0).optional().default(0),

  water_deposit_amount: z.coerce.number().min(0).optional().default(DEFAULT_WATER_DEPOSIT),
  water_deposit_paid: z.coerce.number().min(0).optional().default(0),

  rent_payment_phone: z.string().trim().max(30).optional().nullable(),
  rent_bank_reference: z.string().trim().max(150).optional().nullable(),
  water_payment_phone: z.string().trim().max(30).optional().nullable(),
  water_bank_reference: z.string().trim().max(150).optional().nullable(),

  notes: z.string().trim().optional().nullable(),
});

const updateTenantSchema = createTenantSchema
  .omit({ property_id: true, unit_id: true })
  .extend({
    property_id: z.coerce.number().int().positive().optional(),
    unit_id: z.coerce.number().int().positive().optional(),
    status: tenantStatusSchema.optional(),
  })
  .partial();

const listTenantsQuerySchema = z.object({
  property_id: z.coerce.number().int().positive().optional(),
  unit_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['all', 'active', 'moving_out', 'archived']).default('active').optional(),
  balance: z.enum(['all', 'in_arrears', 'credit', 'paid']).default('all').optional(),
  search: z.string().trim().optional(),
});

const moveOutTenantSchema = z.object({
  move_out_date: z.string().trim().optional().nullable(),
  deposit_refund: z.enum(['full_refund', 'partial_refund', 'no_refund']).default('full_refund').optional(),
  reason: z.string().trim().max(500).optional().nullable(),
});

module.exports = {
  createTenantSchema,
  updateTenantSchema,
  listTenantsQuerySchema,
  moveOutTenantSchema,
};