const { z } = require('zod');

const updateProfileSchema = z.object({
  first_name: z.string().trim().min(1, 'First name is required').max(100).optional(),
  last_name: z.string().trim().min(1, 'Last name is required').max(100).optional(),
  email: z.string().trim().email('Invalid email format').optional().nullable(),
});

const updatePhoneSchema = z.object({
  phone: z.string().trim().min(7, 'Phone number is required').max(30),
  code: z.string().trim().length(6, 'OTP code must be 6 digits').optional(),
});

const notificationPreferencesSchema = z.object({
  sms_payment_received: z.boolean().optional(),
  sms_rent_reminder: z.boolean().optional(),
  sms_water_reading_reminder: z.boolean().optional(),
  sms_suspicious_water: z.boolean().optional(),
  email_weekly_summary: z.boolean().optional(),
  email_monthly_report: z.boolean().optional(),
  push_payment_received: z.boolean().optional(),
  push_maintenance_assigned: z.boolean().optional(),
});

const inviteUserSchema = z.object({
  email: z.string().trim().email('Invalid email format').optional(),
  phone: z.string().trim().min(7, 'Phone number is required').max(30).optional(),
  role: z.enum(['owner', 'caretaker', 'accountant']),
  permission_level: z.number().int().min(1).max(3).default(1),
  property_id: z.coerce.number().int().positive().optional().nullable(),
  message: z.string().trim().max(500).optional().nullable(),
}).refine(data => data.email || data.phone, {
  message: 'Either email or phone number is required',
});

const listAuditLogsSchema = z.object({
  user_id: z.coerce.number().int().positive().optional(),
  action: z.string().trim().optional(),
  entity_type: z.string().trim().optional(),
  start_date: z.string().trim().optional(),
  end_date: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const listInvitesSchema = z.object({
  status: z.enum(['pending', 'accepted', 'expired', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

module.exports = {
  updateProfileSchema,
  updatePhoneSchema,
  notificationPreferencesSchema,
  inviteUserSchema,
  listAuditLogsSchema,
  listInvitesSchema,
};