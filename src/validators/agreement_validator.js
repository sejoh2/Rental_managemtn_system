const { z } = require('zod');

const agreementTemplateSchema = z.object({
  property_id: z.coerce.number().int().positive().optional().nullable(),
  name: z.string().trim().min(2).max(150).default('Default tenancy agreement'),
  template_text: z.string().trim().min(20, 'Agreement template is too short'),
  is_default: z.boolean().optional().default(true),
});

module.exports = {
  agreementTemplateSchema,
};