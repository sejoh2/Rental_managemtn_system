const { z } = require('zod');

const reportTypeSchema = z.enum([
  'full_monthly_summary',
  'rent_collection',
  'arrears',
  'water_billing',
  'occupancy',
  'sms_usage',
  'tenant_statement',
  'custom',
]);

const exportFormatSchema = z.enum(['pdf', 'csv']);

const exportReportSchema = z.object({
  report_type: reportTypeSchema,
  property_id: z.coerce.number().int().positive().optional().nullable(),
  tenant_id: z.coerce.number().int().positive().optional().nullable(),
  start_date: z.string().trim().optional().nullable(),
  end_date: z.string().trim().optional().nullable(),
  format: exportFormatSchema.default('pdf'),
  include_charts: z.boolean().default(true),
});

const occupancyReportSchema = z.object({
  property_id: z.coerce.number().int().positive().optional().nullable(),
});

const arrearsReportSchema = z.object({
  property_id: z.coerce.number().int().positive().optional().nullable(),
  min_balance: z.coerce.number().min(0).default(0),
});

const rentCollectionSchema = z.object({
  property_id: z.coerce.number().int().positive().optional().nullable(),
  start_date: z.string().trim().optional().nullable(),
  end_date: z.string().trim().optional().nullable(),
});

const waterBillingReportSchema = z.object({
  property_id: z.coerce.number().int().positive().optional().nullable(),
  start_date: z.string().trim().optional().nullable(),
  end_date: z.string().trim().optional().nullable(),
});

const tenantStatementSchema = z.object({
  tenant_id: z.coerce.number().int().positive('Tenant is required'),
  start_date: z.string().trim().optional().nullable(),
  end_date: z.string().trim().optional().nullable(),
});

const reportHistoryQuerySchema = z.object({
  report_type: reportTypeSchema.optional(),
  status: z.enum(['generating', 'ready', 'failed', 'expired']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

module.exports = {
  reportTypeSchema,
  exportFormatSchema,
  exportReportSchema,
  occupancyReportSchema,
  arrearsReportSchema,
  rentCollectionSchema,
  waterBillingReportSchema,
  tenantStatementSchema,
  reportHistoryQuerySchema,
};