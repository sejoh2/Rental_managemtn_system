const { z } = require('zod');

const maintenancePrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);
const maintenanceStatusSchema = z.enum(['reported', 'in_progress', 'resolved', 'cancelled']);
const maintenanceCategorySchema = z.enum([
  'plumbing',
  'electrical',
  'structural',
  'appliance',
  'furniture',
  'cleaning',
  'security',
  'pest_control',
  'landscaping',
  'other',
]);

const createMaintenanceSchema = z.object({
  property_id: z.coerce.number().int().positive('Property is required'),
  unit_id: z.coerce.number().int().positive().optional().nullable(),
  title: z.string().trim().min(3, 'Title is required').max(255),
  description: z.string().trim().max(2000).optional().nullable(),
  category: maintenanceCategorySchema,
  priority: maintenancePrioritySchema.default('medium'),
  estimated_cost: z.coerce.number().min(0).default(0),
  notes: z.string().trim().max(500).optional().nullable(),
  attachments: z.array(z.string().url()).default([]),
});

const updateMaintenanceSchema = createMaintenanceSchema
  .omit({ property_id: true })
  .partial()
  .extend({
    property_id: z.coerce.number().int().positive().optional(),
    assigned_to: z.coerce.number().int().positive().optional().nullable(),
  });

const updateStatusSchema = z.object({
  status: maintenanceStatusSchema,
  notes: z.string().trim().max(500).optional().nullable(),
  actual_cost: z.coerce.number().min(0).optional(),
});

const assignMaintenanceSchema = z.object({
  assigned_to: z.coerce.number().int().positive('Caretaker is required'),
});

const listMaintenanceQuerySchema = z.object({
  property_id: z.coerce.number().int().positive().optional(),
  unit_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['all', 'reported', 'in_progress', 'resolved', 'cancelled']).default('all').optional(),
  priority: maintenancePrioritySchema.optional(),
  category: maintenanceCategorySchema.optional(),
  assigned_to: z.coerce.number().int().positive().optional(),
  search: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const maintenanceStatsSchema = z.object({
  property_id: z.coerce.number().int().positive().optional(),
});

module.exports = {
  maintenancePrioritySchema,
  maintenanceStatusSchema,
  maintenanceCategorySchema,
  createMaintenanceSchema,
  updateMaintenanceSchema,
  updateStatusSchema,
  assignMaintenanceSchema,
  listMaintenanceQuerySchema,
  maintenanceStatsSchema,
};