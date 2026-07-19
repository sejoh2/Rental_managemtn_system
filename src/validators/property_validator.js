const { z } = require('zod');

const propertyTypeSchema = z.enum([
  'apartment_block',
  'bedsitters',
  'mixed_use',
  'single_rooms',
]);

const paymentAccountTypeSchema = z.enum([
  'paybill',
  'till',
  'bank',
  'mpesa_paybill',
  'mpesa_till',
  'bank_account',
  'cash',
  'other',
]);

const waterBillingMethodSchema = z.enum([
  'per_unit_metered',
  'fixed_monthly',
  'included_in_rent',
]);

const waterMissedReadingActionSchema = z.enum([
  'carry_forward',
  'do_not_bill',
  'estimate_average',
]);

const accountSchema = z.object({
  account_type: paymentAccountTypeSchema.optional(),
  provider_name: z.string().trim().max(100).optional().nullable(),
  bank_name: z.string().trim().max(100).optional().nullable(),
  business_number: z.string().trim().max(100).optional().nullable(),
  till_number: z.string().trim().max(100).optional().nullable(),
  account_number: z.string().trim().max(100).optional().nullable(),
  account_name: z.string().trim().max(150).optional().nullable(),
  label: z.string().trim().max(150).optional().nullable(),
  raw_value: z.string().trim().max(150).optional().nullable(),
}).optional().nullable();

const createPropertySchema = z.object({
  name: z.string().trim().min(2, 'Property name is required').max(255),
  location: z.string().trim().min(2, 'Location is required').max(255),
  property_type: propertyTypeSchema.default('apartment_block'),
  expected_units: z.coerce.number().int().min(0).default(0),
  rent_due_day: z.string().trim().min(1).max(100).default('5th of every month'),
  caretaker_id: z.coerce.number().int().positive().optional().nullable(),
  
  // Water billing settings
  water_billing_method: waterBillingMethodSchema.default('per_unit_metered'),
  water_rate_per_unit: z.coerce.number().min(0).default(100),
  water_fixed_fee: z.coerce.number().min(0).default(0),
  water_billing_day: z.string().trim().max(50).default('same_as_rent'),
  water_reading_due_days: z.coerce.number().int().min(1).max(30).default(3),
  water_missed_reading_action: waterMissedReadingActionSchema.default('carry_forward'),
  
  sms_sender_id: z.string().trim().max(50).optional().nullable(),
  rent_account: accountSchema,
  water_account: accountSchema,
});

const updatePropertySchema = createPropertySchema.partial();

const waterRulesSchema = z.object({
  water_billing_method: waterBillingMethodSchema.optional(),
  water_rate_per_unit: z.coerce.number().min(0).optional(),
  water_fixed_fee: z.coerce.number().min(0).optional(),
  water_billing_day: z.string().trim().max(50).optional(),
  water_reading_due_days: z.coerce.number().int().min(1).max(30).optional(),
  water_missed_reading_action: waterMissedReadingActionSchema.optional(),
});

module.exports = {
  createPropertySchema,
  updatePropertySchema,
  waterRulesSchema,
};