'use client';
import { track } from '../../services/analytics';
import { useEffect, useRef, useState } from 'react';
import { Sparkles, ArrowUpRight, Check, Info, LoaderCircle, RotateCcw } from 'lucide-react';
import type { Room, Recommendation } from '../../contracts/schemas';
import { useApp } from '../../shared/AppProvider';
export function RecommendationPanel({ rooms }: { rooms: Room[] }) {
  const { api, filters } = useApp();
  const [prompt, setPrompt] = useState(''),
    [result, setResult] = useState<Recommendation | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const key = rooms.map((r) => r.id).join(',');
  useEffect(() => {
    controller.current?.abort();
    setResult(null);
    setBusy(false);
    setError('');
    return () => controller.current?.abort();
  }, [key, filters]);
  async function request() {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const r = await api.recommend(
        { roomIds: rooms.map((r) => r.id), filters, prompt: prompt.trim() },
        c.signal,
      );
      if (!c.signal.aborted) {
        setResult(r);
        track(
          r.mode === 'ai' ? 'recommendation_ai' : 'recommendation_rules',
          rooms.map((x) => x.id),
        );
      }
    } catch (e) {
      if (!c.signal.aborted) setError((e as Error).message);
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="recommendation-panel">
      <div className="recommendation-heading">
        <span className="ai-icon">
          <Sparkles size={25} />
        </span>
        <div>
          <p className="eyebrow">나의 선택을 돕는 한마디</p>
          <h2>두 방, 어떤 점이 다를까요?</h2>
        </div>
        <span className="ai-label">AI 비교 도우미</span>
      </div>
      <p>원하는 생활을 알려 주세요. 선택한 매물의 정보를 근거로 정리해 드려요.</p>
      <label className="prompt-label" htmlFor="recommend-prompt">
        추가로 바라는 점 <span>선택</span>
      </label>
      <div className="prompt-row">
        <textarea
          id="recommend-prompt"
          maxLength={500}
          rows={2}
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            setResult(null);
          }}
          placeholder="예: 아침 수업이 많아서 학교가 가깝고, 관리비를 포함해 40만원 이하면 좋겠어요."
        />
        <button className="btn dark" disabled={busy} onClick={request}>
          {busy ? (
            <>
              <LoaderCircle size={17} className="spin" />
              정리하는 중
            </>
          ) : (
            <>
              <Sparkles size={17} />
              {result ? '다시 비교하기' : '비교 요약 보기'}
              <ArrowUpRight size={16} />
            </>
          )}
        </button>
      </div>
      <div className="prompt-meta">
        <span>등록된 매물 정보만 사용해요</span>
        <span>{prompt.length} / 500</span>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          {error}
          <button onClick={request}>
            <RotateCcw size={15} />
            다시 시도
          </button>
        </div>
      )}
      {result && (
        <div className="recommendation-result" aria-live="polite">
          <div className="summary-label">
            <span>{result.mode === 'rules' ? '규칙 기반 요약' : 'AI 요약'}</span>
            {result.fallbackReason && <p>{result.fallbackReason}</p>}
          </div>
          <h3>{result.summary}</h3>
          <div className="reason-grid">
            {result.items.map((item) => (
              <article key={item.roomId}>
                <h4>{rooms.find((r) => r.id === item.roomId)?.title ?? '매물'}</h4>
                {item.reasons.map((r, i) => (
                  <p key={i}>
                    <Check size={15} />
                    <span>{r.text}</span>
                  </p>
                ))}
                {item.tradeoffs.map((r, i) => (
                  <p className="tradeoff" key={i}>
                    <Info size={15} />
                    <span>{r.text}</span>
                  </p>
                ))}
                {!item.reasons.length && !item.tradeoffs.length && <p>요약할 정보가 부족해요.</p>}
              </article>
            ))}
          </div>
          <div className="limitations">
            {result.limitations.map((text, i) => (
              <p key={i}>· {text}</p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
