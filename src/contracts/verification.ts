import { z } from 'zod';

// Approval is issued by the server after independent property/identity review.
// The client never calculates or submits an approved status.
export const VerificationStatusSchema = z.object({
  status: z.enum(['not_submitted', 'reviewing', 'needs_info', 'approved', 'rejected']),
  applicationId: z.string().nullable(),
  submittedAt: z.string().datetime().nullable(),
  message: z.string().max(300).nullable(),
});
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const emptyVerification: VerificationStatus = {
  status: 'not_submitted',
  applicationId: null,
  submittedAt: null,
  message: null,
};

export const VerificationInputSchema = z.object({
  ownerName: z.string().trim().min(2).max(80),
  buildingAddress: z.string().trim().min(5).max(200),
  consent: z.literal(true),
});
export type VerificationInput = z.infer<typeof VerificationInputSchema>;

export const MAX_PROOF_BYTES = 5 * 1024 * 1024;
export const PROOF_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
