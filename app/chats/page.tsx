import { Suspense } from 'react';
import { ChatScreen } from '@/src/features/chat/ChatScreen';

export default function Page() {
  return (
    <Suspense fallback={<main className="chat-shell">대화를 불러오고 있어요…</main>}>
      <ChatScreen />
    </Suspense>
  );
}
