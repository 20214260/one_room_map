import { z } from 'zod';
import { VerificationStatusSchema } from './verification';

// Admin-only review data (backend/app/routers/admin.py). Never reuse for applicant responses.
export const AiReviewSchema = z.object({
  model: z.string(),
  extracted: z.object({
    documentType: z.enum(['registry', 'other', 'unknown']),
    ownerNames: z.array(z.string()),
    buildingAddress: z.string().nullable(),
    issuedAt: z.string().nullable(),
  }),
  checks: z.array(
    z.object({
      field: z.enum(['ownerName', 'buildingAddress', 'documentType', 'issuedAt']),
      result: z.enum(['match', 'mismatch', 'unclear']),
      note: z.string(),
    }),
  ),
  summary: z.string(),
});
export type AiReview = z.infer<typeof AiReviewSchema>;

export const AdminVerificationSchema = VerificationStatusSchema.extend({
  userId: z.string(),
  email: z.string(),
  ownerName: z.string().nullable(),
  buildingAddress: z.string().nullable(),
  proof: z.object({ mime: z.string(), size: z.number().int().nonnegative() }).nullable(),
  reviewedAt: z.string().datetime().nullable(),
  // Advisory only. Null means AI is not connected or failed; the admin checks the document directly.
  aiReview: AiReviewSchema.nullable(),
});
export type AdminVerification = z.infer<typeof AdminVerificationSchema>;
export const AdminVerificationsSchema = z.object({ items: z.array(AdminVerificationSchema) });

export const reviewFilters = ['reviewing', 'needs_info', 'approved', 'rejected'] as const;
export type ReviewFilter = (typeof reviewFilters)[number];

// approved → rejected is a revocation. needs_info / rejected require a message for the applicant.
export const DecisionSchema = z
  .object({
    applicationId: z.string().min(1),
    status: z.enum(['approved', 'needs_info', 'rejected']),
    message: z.string().trim().max(300).nullable(),
  })
  .refine((v) => v.status === 'approved' || !!v.message, {
    message: '보완 요청·반려는 신청자에게 보낼 안내를 입력해 주세요.',
    path: ['message'],
  });
export type Decision = z.infer<typeof DecisionSchema>;
