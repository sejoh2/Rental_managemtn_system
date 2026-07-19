const { z } = require('zod');

const unitTypeSchema = z.enum([
  'single_room',
  'bedsitter',
  'one_bedroom',
  'two_bedroom',
  'three_bedroom',
  'shop',
  'other',
]);

const unitStatusSchema = z.enum([
  'vacant',
  'occupied',
  'maintenance',
  'archived',
]);

const createUnitSchema = z.object({
  property_id: z.coerce.number().int().positive('Property is required'),
  unit_number: z.string().trim().min(1, 'House / unit number is required').max(100),
  floor: z.string().trim().max(100).optional().nullable(),
  unit_type: unitTypeSchema.default('single_room'),
  monthly_rent: z.coerce.number().min(0).default(0),
  deposit_amount: z.coerce.number().min(0).default(0),
  water_meter_number: z.string().trim().max(100).optional().nullable(),
  status: unitStatusSchema.default('vacant'),
  notes: z.string().trim().optional().nullable(),
});

const updateUnitSchema = createUnitSchema
  .omit({ property_id: true })
  .partial();

const listUnitsQuerySchema = z.object({
  property_id: z.coerce.number().int().positive().optional(),
  status: z
    .enum(['all', 'occupied', 'vacant', 'maintenance', 'under_maintenance', 'in_arrears'])
    .default('all')
    .optional(),
});

module.exports = {
  createUnitSchema,
  updateUnitSchema,
  listUnitsQuerySchema,
};