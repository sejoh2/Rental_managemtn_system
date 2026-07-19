const { z } = require('zod');

const recipientsTypeSchema = z.enum(['all', 'property', 'arrears', 'credit', 'specific']);
const broadcastStatusSchema = z.enum(['draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed']);
const messageStatusSchema = z.enum(['pending', 'sent', 'delivered', 'failed', 'scheduled', 'cancelled']);

const createTemplateSchema = z.object({
  name: z.string().trim().min(2, 'Template name is required').max(100),
  content: z.string().trim().min(5, 'Template content is required').max(1600),
  is_default: z.boolean().default(false),
});

const updateTemplateSchema = createTemplateSchema.partial();

const createBroadcastSchema = z.object({
  name: z.string().trim().min(2, 'Broadcast name is required').max(100),
  template_id: z.coerce.number().int().positive().optional().nullable(),
  message: z.string().trim().min(1, 'Message is required').max(1600),
  recipients_type: recipientsTypeSchema.default('all'),
  property_id: z.coerce.number().int().positive().optional().nullable(),
  recipient_ids: z.array(z.coerce.number().int().positive()).default([]),
  scheduled_at: z.string().trim().optional().nullable(),
});

const updateBroadcastSchema = z.object({
  name: z.string().trim().max(100).optional(),
  message: z.string().trim().max(1600).optional(),
  scheduled_at: z.string().trim().optional().nullable(),
  status: broadcastStatusSchema.optional(),
}).partial();

const listBroadcastsQuerySchema = z.object({
  status: broadcastStatusSchema.optional(),
  start_date: z.string().trim().optional(),
  end_date: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const listMessagesQuerySchema = z.object({
  broadcast_id: z.coerce.number().int().positive().optional(),
  tenant_id: z.coerce.number().int().positive().optional(),
  status: messageStatusSchema.optional(),
  start_date: z.string().trim().optional(),
  end_date: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// Webhook delivery status update
const deliveryWebhookSchema = z.object({
  id: z.string().trim(), // Provider message ID
  status: z.enum(['sent', 'delivered', 'failed']),
  failureReason: z.string().trim().optional().nullable(),
  cost: z.coerce.number().min(0).optional(),
});

module.exports = {
  recipientsTypeSchema,
  broadcastStatusSchema,
  messageStatusSchema,
  createTemplateSchema,
  updateTemplateSchema,
  createBroadcastSchema,
  updateBroadcastSchema,
  listBroadcastsQuerySchema,
  listMessagesQuerySchema,
  deliveryWebhookSchema,
};