const { z } = require('zod');

const permissionLevelSchema = z.number().int().min(1).max(3);

const createCaretakerSchema = z.object({
  full_name: z.string().trim().min(2, 'Full name is required').max(200),
  phone: z.string().trim().min(7, 'Phone number is required').max(30),
  property_id: z.coerce.number().int().positive('Property is required'),
  permission_level: permissionLevelSchema.default(1),
  notes: z.string().trim().max(500).optional().nullable(),
});

const updateCaretakerSchema = z.object({
  full_name: z.string().trim().min(2, 'Full name is required').max(200).optional(),
  phone: z.string().trim().min(7, 'Phone number is required').max(30).optional(),
  property_id: z.coerce.number().int().positive('Property is required').optional(),
  permission_level: permissionLevelSchema.optional(),
  status: z.enum(['active', 'inactive']).optional(),
  notes: z.string().trim().max(500).optional().nullable(),
});

const listCaretakersQuerySchema = z.object({
  property_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['all', 'active', 'inactive']).default('all').optional(),
  permission_level: permissionLevelSchema.optional(),
  search: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

module.exports = {
  createCaretakerSchema,
  updateCaretakerSchema,
  listCaretakersQuerySchema,
  permissionLevelSchema,
};