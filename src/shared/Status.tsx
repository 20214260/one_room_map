import { CircleAlert, SearchX, RefreshCw } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
export function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="status-box" role="alert">
      <CircleAlert size={30} />
      <h3>정보를 가져오지 못했어요</h3>
      <p>{message}</p>
      <button className="btn secondary" onClick={retry}>
        <RefreshCw size={16} />
        다시 시도
      </button>
    </div>
  );
}
export function EmptyState({ reset }: { reset: () => void }) {
  return (
    <div className="status-box">
      <SearchX size={34} />
      <h3>조건에 맞는 방이 없어요</h3>
      <p>예산을 조금 넓히거나 다른 생활권을 살펴보세요.</p>
      <button className="btn secondary" onClick={reset}>
        조건 초기화
      </button>
    </div>
  );
}
export function LoadingCards() {
  return (
    <div className="room-grid" aria-label="매물 불러오는 중">
      {[0, 1, 2, 3].map((i) => (
        <div className="room-card" key={i}>
          <Skeleton className="h-48 w-full rounded-none" />
          <div className="card-body">
            <Skeleton className="mb-3 h-6 w-2/3" />
            <Skeleton className="mb-4 h-4 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
