const { z } = require('zod');

// Middleware factory: validates req.body against a zod schema
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }
    req.body = result.data;
    next();
  };
}

// Schemas
const VALID_APP_STATUSES = [
  'identified', 'ready_to_apply', 'applied', 'interviewing', 'closed',
];

const VALID_CLOSED_REASONS = [
  'offer', 'rejected', 'withdrawn', 'no_response', 'other',
];

const VALID_CONTACT_KINDS = [
  'hiring_manager', 'recruiter', 'interviewer', 'referrer', 'other',
];
const VALID_OUTREACH_STATUSES = ['not contacted', 'draft', 'linkedin', 'contacted', 'in conversation', 'bounced', 'passed'];
const VALID_LEAD_STATUSES = ['new', 'reviewed', 'snagged', 'snoozed'];

const applicationCreate = z.object({
  company: z.string().min(1).max(200),
  role: z.string().min(1).max(200),
  source_url: z.string().url().max(2000).or(z.literal('')).optional().default(''),
  notion_url: z.string().max(2000).optional().default(''),
  notes: z.string().max(5000).optional().default(''),
  applied_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(VALID_APP_STATUSES).optional(),
});

const applicationPatch = z.object({
  company: z.string().min(1).max(200).optional(),
  role: z.string().min(1).max(200).optional(),
  status: z.enum(VALID_APP_STATUSES).optional(),
  source_url: z.string().max(2000).optional(),
  notion_url: z.string().max(2000).optional(),
  drive_url: z.string().max(2000).optional(),
  drive_folder_id: z.string().max(200).optional(),
  follow_up_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  snoozed_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  closed_reason: z.enum(VALID_CLOSED_REASONS).nullable().optional(),
  notes: z.string().max(5000).optional(),
  cover_letter_text: z.string().max(10000).optional(),
  resume_variant: z.string().max(50).optional(),
  activity_note: z.string().max(1000).optional(),
  last_activity: z.string().optional(),
  activity: z.array(z.any()).optional(),
}).passthrough();

const outreachPatch = z.object({
  status: z.enum(VALID_OUTREACH_STATUSES).optional(),
  notes: z.string().max(5000).optional(),
  followup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  is_job_search: z.boolean().optional(),
  gmail_thread_id: z.string().max(200).optional(),
  cadence_day: z.number().int().min(1).max(30).optional(),
  last_contacted: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();

const leadPatch = z.object({
  status: z.enum(VALID_LEAD_STATUSES).optional(),
  snoozed: z.boolean().optional(),
}).passthrough();

const leadBatchUpdate = z.object({
  updates: z.array(z.object({
    id: z.string().min(1),
    status: z.enum(VALID_LEAD_STATUSES).optional(),
  }).passthrough()).min(1).max(200),
});

const snagRequest = z.object({
  lead_id: z.string().min(1),
});

const eventCreate = z.object({
  title: z.string().min(1).max(300),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().max(20).optional().default(''),
  end_time: z.string().max(20).optional().default(''),
  location: z.string().max(300).optional().default(''),
  type: z.string().max(50).optional().default('other'),
  notes: z.string().max(10000).optional().default(''),
  contacts: z.array(z.any()).optional().default([]),
  next_steps: z.array(z.any()).optional().default([]),
});

const loginRequest = z.object({
  password: z.string().min(1).max(500),
});

const bulkApplicationAction = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  action: z.enum(['set_status', 'delete', 'snooze', 'generate_letter']),
  value: z.any().optional(),
});

const snoozeRequest = z.object({
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

const parseUrlRequest = z.object({
  url: z.string().url().max(2000),
});

const applicationContactCreate = z.object({
  name: z.string().min(1).max(200),
  title: z.string().max(200).optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
  linkedin_url: z.string().url().max(500).optional().nullable(),
  kind: z.enum(VALID_CONTACT_KINDS).optional().default('other'),
  notes: z.string().max(5000).optional().nullable(),
});

const applicationContactPatch = applicationContactCreate.partial();

const chatMessageRequest = z.object({
  message: z.string().min(1).max(4000),
});

module.exports = {
  validate,
  schemas: {
    applicationCreate,
    applicationPatch,
    outreachPatch,
    leadPatch,
    leadBatchUpdate,
    snagRequest,
    eventCreate,
    loginRequest,
    bulkApplicationAction,
    snoozeRequest,
    parseUrlRequest,
    applicationContactCreate,
    applicationContactPatch,
    chatMessageRequest,
  },
  VALID_APP_STATUSES,
  VALID_CLOSED_REASONS,
  VALID_CONTACT_KINDS,
  VALID_OUTREACH_STATUSES,
  VALID_LEAD_STATUSES,
};
