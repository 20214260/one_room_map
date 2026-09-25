import { z } from 'zod';

export const ChatTextSchema = z.string().trim().min(1).max(500);
export const VisitDecisionSchema = z.enum(['accepted', 'declined']);
export type VisitDecision = z.infer<typeof VisitDecisionSchema>;
export const ChatMessageSchema = z.object({
  id: z.string(),
  senderId: z.string(),
  kind: z.enum(['text', 'visit_proposal', 'visit_response']),
  text: z.string(),
  createdAt: z.string().datetime(),
  visitAt: z.string().datetime().nullable(),
  proposalId: z.string().nullable(),
  decision: VisitDecisionSchema.nullable(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export const ChatRoomSchema = z.object({
  id: z.string(),
  title: z.string(),
  photoUrl: z.string().nullable(),
  location: z.string(),
  deposit: z.number().int().nonnegative().nullable(),
  rent: z.number().int().nonnegative().nullable(),
  maintenance: z.number().int().nonnegative().nullable(),
  status: z.enum(['published', 'pending_review', 'hidden', 'closed', 'deleted']),
});
export const ChatSummarySchema = z.object({
  id: z.string(),
  room: ChatRoomSchema,
  otherPartyName: z.string(),
  unreadCount: z.number().int().nonnegative(),
  lastMessage: ChatMessageSchema.nullable(),
  updatedAt: z.string().datetime(),
  blocked: z.boolean(),
});
export type ChatSummary = z.infer<typeof ChatSummarySchema>;
export const ChatDetailSchema = ChatSummarySchema.extend({ messages: z.array(ChatMessageSchema) });
export type ChatDetail = z.infer<typeof ChatDetailSchema>;
export const ChatsResponseSchema = z.object({ items: z.array(ChatSummarySchema) });
export const StartChatSchema = z.object({ roomId: z.string(), message: ChatTextSchema });
export const ReportReasonSchema = z.enum(['spam', 'inappropriate', 'other']);

// The mock storage is private; only ChatSummary/ChatDetail cross the gateway boundary.
export const StoredChatSchema = z.object({
  id: z.string(),
  room: ChatRoomSchema,
  ownerId: z.string(),
  seekerId: z.string(),
  ownerName: z.string(),
  seekerName: z.string(),
  messages: z.array(ChatMessageSchema),
  seenOwner: z.string().nullable(),
  seenSeeker: z.string().nullable(),
  blockedBy: z.string().nullable(),
  reports: z.array(z.object({ userId: z.string(), reason: ReportReasonSchema })),
});
export type StoredChat = z.infer<typeof StoredChatSchema>;
