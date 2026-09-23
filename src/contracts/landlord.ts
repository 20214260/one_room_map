import { z } from 'zod';
import { RoomSchema, RoomSubmissionSchema } from './schemas';

export const ListingStatusSchema = z.enum(['pending_review', 'published', 'hidden', 'closed']);
export type ListingStatus = z.infer<typeof ListingStatusSchema>;
export const listingStatusLabels: Record<ListingStatus, string> = {
  pending_review: '검수 대기',
  published: '공개 중',
  hidden: '비공개',
  closed: '거래 완료',
};
// Private owner response. Never use this shape for public list/get responses.
export const OwnerListingSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  submission: RoomSubmissionSchema.omit({ pastedListingText: true }),
  status: ListingStatusSchema,
  updatedAt: z.string(),
});
export type OwnerListing = z.infer<typeof OwnerListingSchema>;
export const OwnerListingsSchema = z.object({ items: z.array(OwnerListingSchema) });
export const InboxItemSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  roomTitle: z.string(),
  message: z.string(),
  createdAt: z.string(),
  read: z.boolean(),
});
export type InboxItem = z.infer<typeof InboxItemSchema>;
export const InboxSchema = z.object({ items: z.array(InboxItemSchema) });
export const DraftRequestSchema = RoomSubmissionSchema.pick({
  title: true,
  locationHint: true,
  rent: true,
  deposit: true,
  maintenance: true,
  options: true,
  pastedListingText: true,
}).partial();
export type DraftRequest = z.infer<typeof DraftRequestSchema>;
export const DraftResponseSchema = z.object({
  mode: z.enum(['ai', 'rules']),
  description: z.string().max(1000),
  hints: RoomSubmissionSchema.pick({ deposit: true, maintenance: true, rent: true }).partial(),
  limitations: z.array(z.string()),
});
export type DraftResponse = z.infer<typeof DraftResponseSchema>;
export const UploadResponseSchema = z.object({ photo: RoomSchema.shape.photos.element });
export type UploadResponse = z.infer<typeof UploadResponseSchema>;
