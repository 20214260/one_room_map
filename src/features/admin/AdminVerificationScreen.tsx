'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  FileText,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '../../shared/AppProvider';
import { Header } from '../../shared/Header';
import { ApiError } from '../../services/errors';
import {
  reviewFilters,
  type AdminVerification,
  type AiReview,
  type Decision,
  type ReviewFilter,
} from '../../contracts/admin';

const statusLabels: Record<AdminVerification['status'], string> = {
  not_submitted: '신청 전',
  reviewing: '심사 중',
  needs_info: '보완 요청',
  approved: '승인',
  rejected: '반려',
};
const checkFields: Record<AiReview['checks'][number]['field'], string> = {
  ownerName: '소유자 이름',
  buildingAddress: '건물 주소',
  documentType: '서류 종류',
  issuedAt: '발급일',
};
const checkResults: Record<AiReview['checks'][number]['result'], string> = {
  match: '일치',
  mismatch: '불일치',
  unclear: '확인 필요',
};
const dateTime = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
const when = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : '—');
const size = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(bytes / 1024)}KB`;

export function AdminVerificationScreen() {
  const { api, user, authLoading, config } = useApp();
  const [filter, setFilter] = useState<ReviewFilter>('reviewing');
  const [version, setVersion] = useState(0);
  // Results are keyed by the request so a new tab/refresh shows loading without resetting state in the effect.
  const key = `${user?.id}:${filter}:${version}`;
  const [result, setResult] = useState<{
    key: string;
    items?: AdminVerification[];
    error?: { forbidden: boolean; message: string };
  } | null>(null);
  const current = result?.key === key ? result : null;
  const items = current?.items ?? null;
  const error = current?.error ?? null;

  useEffect(() => {
    if (authLoading || !user) return;
    const controller = new AbortController();
    api
      .listVerifications(filter, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, items: data.items });
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        const forbidden =
          cause instanceof ApiError && (cause.status === 403 || cause.status === 401);
        setResult({ key, error: { forbidden, message: (cause as Error).message } });
      });
    return () => controller.abort();
  }, [api, authLoading, user, filter, key]);

  function decided(updated: AdminVerification) {
    toast.success(
      `${updated.ownerName || updated.email} 신청을 ${statusLabels[updated.status]} 처리했어요.`,
    );
    setResult((prev) =>
      prev && prev.items
        ? {
            ...prev,
            items: prev.items.flatMap((row) =>
              row.userId !== updated.userId ? [row] : updated.status === filter ? [updated] : [],
            ),
          }
        : prev,
    );
  }

  return (
    <>
      <Header />
      <main className="owner-shell verification-shell admin-shell">
        <div className="verification-intro">
          <p className="eyebrow">SUNROOM · ADMIN REVIEW</p>
          <h1>
            집주인 인증,
            <br />
            <em>서류를 보고 결정해요.</em>
          </h1>
          <p>
            AI 결과는 참고용이에요. 등기사항증명서의 소유자·주소를 직접 확인한 뒤 승인해 주세요.
          </p>
          {config.mode === 'mock' && (
            <div className="verification-demo">
              시연 모드 · &apos;사용자로 체험&apos; 계정이 관리자 역할을 해요. 이름·주소·서류는
              저장하지 않으므로 상태만 바뀌어요.
            </div>
          )}
        </div>

        {authLoading ? (
          <section className="verification-card" aria-busy="true">
            <LoaderCircle className="spin" /> 계정을 확인하고 있어요.
          </section>
        ) : !user || error?.forbidden ? (
          <section className="verification-card">
            <LockKeyhole size={28} />
            <h2>관리자 계정으로 로그인해 주세요.</h2>
            <p>집주인 인증 심사는 지정된 관리자만 할 수 있어요.</p>
            <Link className="btn primary" href="/login?returnTo=%2Fadmin">
              {user ? '다른 계정으로 로그인' : '로그인하기'} <ArrowRight size={16} />
            </Link>
          </section>
        ) : (
          <>
            <div className="owner-tabs admin-tabs" role="tablist" aria-label="심사 상태">
              {reviewFilters.map((key) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={filter === key}
                  onClick={() => setFilter(key)}
                >
                  {statusLabels[key]}
                  {filter === key && items && <span>{items.length}</span>}
                </button>
              ))}
              <button
                className="admin-refresh"
                onClick={() => setVersion((v) => v + 1)}
                aria-label="목록 새로고침"
              >
                <RefreshCw size={15} />
              </button>
            </div>
            {error ? (
              <div className="owner-empty" role="alert">
                <p>{error.message}</p>
                <button className="btn secondary" onClick={() => setVersion((v) => v + 1)}>
                  다시 불러오기
                </button>
              </div>
            ) : !items ? (
              <div className="owner-empty" role="status">
                <LoaderCircle className="spin" />
                <p>신청 목록을 불러오고 있어요.</p>
              </div>
            ) : items.length === 0 ? (
              <div className="owner-empty">
                <BadgeCheck size={28} />
                <p>{statusLabels[filter]} 상태의 신청이 없어요.</p>
              </div>
            ) : (
              <div className="admin-list">
                {items.map((item) => (
                  <ReviewCard
                    key={`${item.userId}:${item.applicationId}`}
                    item={item}
                    onDecided={decided}
                    onStale={() => setVersion((v) => v + 1)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}

function ReviewCard({
  item,
  onDecided,
  onStale,
}: {
  item: AdminVerification;
  onDecided: (updated: AdminVerification) => void;
  onStale: () => void;
}) {
  const { api } = useApp();
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState<Decision['status'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [loadingProof, setLoadingProof] = useState(false);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function openProof() {
    setLoadingProof(true);
    setError('');
    try {
      const blob = await api.downloadVerificationProof(item.userId);
      const url = URL.createObjectURL(blob);
      if (blob.type.startsWith('image/')) {
        setPreview(url);
      } else {
        // PDFs are downloaded, not rendered in the page. Open them in the viewer's protected mode.
        const link = document.createElement('a');
        link.href = url;
        link.download = `proof-${item.applicationId ?? item.userId}.pdf`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoadingProof(false);
    }
  }

  async function decide(status: Decision['status']) {
    setError('');
    const note = message.trim();
    if (status !== 'approved' && !note) {
      setError('보완 요청·반려는 신청자에게 보낼 안내를 입력해 주세요.');
      return;
    }
    if ((status === 'approved' || item.status === 'approved') && confirming !== status) {
      setConfirming(status);
      return;
    }
    if (!item.applicationId) return;
    setBusy(true);
    try {
      onDecided(
        await api.decideVerification(item.userId, {
          applicationId: item.applicationId,
          status,
          message: note || null,
        }),
      );
    } catch (cause) {
      setError((cause as Error).message);
      if (cause instanceof ApiError && cause.status === 409) onStale();
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  const ai = item.aiReview;
  return (
    <article className="admin-card">
      <header className="admin-card-head">
        <div>
          <h2>{item.ownerName || '이름 미제공'}</h2>
          <p className="owner-muted">{item.email}</p>
        </div>
        <span className={`admin-badge admin-badge-${item.status}`}>
          {statusLabels[item.status]}
        </span>
      </header>

      <dl className="admin-facts">
        <div>
          <dt>건물 주소</dt>
          <dd>{item.buildingAddress || '—'}</dd>
        </div>
        <div>
          <dt>신청 시각</dt>
          <dd>{when(item.submittedAt)}</dd>
        </div>
        {item.reviewedAt && (
          <div>
            <dt>최근 결정</dt>
            <dd>{when(item.reviewedAt)}</dd>
          </div>
        )}
        <div>
          <dt>제출 서류</dt>
          <dd>
            {item.proof ? (
              <button className="admin-proof" onClick={openProof} disabled={loadingProof}>
                {loadingProof ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <FileText size={15} />
                )}
                {item.proof.mime === 'application/pdf' ? 'PDF 내려받기' : '이미지 보기'} ·{' '}
                {size(item.proof.size)}
              </button>
            ) : (
              '서류 없음'
            )}
          </dd>
        </div>
      </dl>
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL of a server re-encoded image
        <img className="admin-preview" src={preview} alt="제출한 등기사항증명서 이미지" />
      )}

      <section className="admin-ai" aria-label="AI 참고 결과">
        <h3>
          <Sparkles size={15} /> AI 참고 결과
        </h3>
        {ai ? (
          <>
            <p>{ai.summary}</p>
            <ul>
              {ai.checks.map((check, index) => (
                <li key={`${check.field}-${index}`}>
                  <span className={`admin-check admin-check-${check.result}`}>
                    {checkResults[check.result]}
                  </span>
                  <b>{checkFields[check.field]}</b> {check.note}
                </li>
              ))}
            </ul>
            <p className="owner-muted">
              서류에서 읽은 소유자: {ai.extracted.ownerNames.join(', ') || '—'} · 주소:{' '}
              {ai.extracted.buildingAddress || '—'} · 모델 {ai.model}
            </p>
          </>
        ) : (
          <p className="owner-muted">
            AI 참고 결과가 없어요. 서류의 소유자 이름과 주소를 직접 비교해 주세요.
          </p>
        )}
      </section>

      {item.message && (
        <p className="admin-last-message">
          신청자에게 보낸 안내: <span>{item.message}</span>
        </p>
      )}

      {(item.status === 'reviewing' || item.status === 'approved') && (
        <div className="admin-decision">
          <label htmlFor={`note-${item.userId}`}>
            신청자에게 보낼 안내 <span>(보완 요청·반려·권한 철회 시 필수)</span>
          </label>
          <textarea
            id={`note-${item.userId}`}
            value={message}
            maxLength={300}
            rows={2}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="예: 등기사항증명서 전체 페이지를 다시 올려 주세요."
          />
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="admin-actions">
            {item.status === 'reviewing' ? (
              <>
                <button className="btn primary" disabled={busy} onClick={() => decide('approved')}>
                  {confirming === 'approved' ? '승인 확정하기' : '승인'}
                </button>
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => decide('needs_info')}
                >
                  보완 요청
                </button>
                <button
                  className="btn secondary admin-danger"
                  disabled={busy}
                  onClick={() => decide('rejected')}
                >
                  반려
                </button>
              </>
            ) : (
              <button
                className="btn secondary admin-danger"
                disabled={busy}
                onClick={() => decide('rejected')}
              >
                {confirming === 'rejected' ? '권한 철회 확정하기' : '권한 철회'}
              </button>
            )}
            {busy && <LoaderCircle size={16} className="spin" />}
            {confirming && !busy && (
              <button className="back-link" onClick={() => setConfirming(null)}>
                취소
              </button>
            )}
          </div>
        </div>
      )}
      {error && item.status !== 'reviewing' && item.status !== 'approved' && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
