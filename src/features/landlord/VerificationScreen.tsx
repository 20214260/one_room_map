'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  FileCheck2,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react';
import { useApp } from '../../shared/AppProvider';
import { Header } from '../../shared/Header';
import {
  emptyVerification,
  VerificationInputSchema,
  MAX_PROOF_BYTES,
  PROOF_TYPES,
  type VerificationStatus,
} from '../../contracts/verification';

export function VerificationScreen() {
  const { api, user, authLoading, config } = useApp();
  const [status, setStatus] = useState<VerificationStatus>(emptyVerification);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [buildingAddress, setBuildingAddress] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (user?.role !== 'landlord') return;
    const controller = new AbortController();
    const refresh = () =>
      api
        .getOwnerVerification(controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) {
            setStatus(data);
            setLoadError('');
            setLoading(false);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setLoadError('인증 상태를 불러오지 못했어요. 서버 연결을 확인해 주세요.');
            setLoading(false);
          }
        });
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 12000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [api, authLoading, user?.id, user?.role]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError('');
    const parsed = VerificationInputSchema.safeParse({ ownerName, buildingAddress, consent });
    if (!parsed.success) {
      setError('이름·건물 주소·제출 동의를 확인해 주세요.');
      return;
    }
    if (
      !proof ||
      !PROOF_TYPES.includes(proof.type as (typeof PROOF_TYPES)[number]) ||
      proof.size === 0 ||
      proof.size > MAX_PROOF_BYTES
    ) {
      setError('등기사항증명서 PDF·JPG·PNG 파일을 5MB 이하로 선택해 주세요.');
      return;
    }
    setBusy(true);
    try {
      const next = await api.submitOwnerVerification(parsed.data, proof);
      setStatus(next);
      setOwnerName('');
      setBuildingAddress('');
      setProof(null);
      setConsent(false);
      form.reset();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const needsForm =
    status.status === 'not_submitted' ||
    status.status === 'needs_info' ||
    status.status === 'rejected';
  return (
    <>
      <Header />
      <main className="owner-shell verification-shell">
        <div className="verification-intro">
          <p className="eyebrow">SUNROOM · OWNER ACCESS</p>
          <h1>
            좋은 방을 소개하기 전,
            <br />
            <em>권한부터 확인할게요.</em>
          </h1>
          <p>
            신청자와 건물 소유 정보가 일치하는지 확인합니다. 승인된 집주인만 방을 등록할 수 있어요.
          </p>
          {config.mode === 'mock' && (
            <div className="verification-demo">
              시연 모드 · 입력한 이름과 서류는 전송하거나 저장하지 않아요. 이 화면은 실제 인증을
              제공하지 않습니다.
            </div>
          )}
        </div>
        {authLoading || (user?.role === 'landlord' && loading) ? (
          <section className="verification-card" aria-busy="true">
            <LoaderCircle className="spin" /> 인증 상태를 확인하고 있어요.
          </section>
        ) : user?.role !== 'landlord' ? (
          <section className="verification-card">
            <LockKeyhole size={28} />
            <h2>집주인 계정으로 로그인해 주세요.</h2>
            <Link className="btn primary" href="/login?returnTo=%2Flandlord%2Fverify">
              로그인하기 <ArrowRight size={16} />
            </Link>
          </section>
        ) : loadError ? (
          <section className="verification-card" role="alert">
            <h2>연결을 확인해 주세요.</h2>
            <p>{loadError}</p>
            <button className="btn primary" onClick={() => location.reload()}>
              다시 확인하기
            </button>
          </section>
        ) : status.status === 'approved' ? (
          <section className="verification-card">
            <BadgeCheck size={38} className="verification-green" />
            <h2>등록 권한이 확인됐어요.</h2>
            <p>{status.message || '이제 방을 등록하고 관리할 수 있어요.'}</p>
            <Link className="btn primary" href="/landlord">
              내 매물 관리하기 <ArrowRight size={16} />
            </Link>
          </section>
        ) : status.status === 'reviewing' ? (
          <section className="verification-card">
            <FileCheck2 size={38} className="verification-green" />
            <h2>제출 내용을 확인하고 있어요.</h2>
            <p>
              AI가 입력 정보를 정리하고, 확인이 필요한 항목은 관리자에게 전달됩니다. 몇 분 이상 걸릴
              수 있으며, 화면을 닫아도 신청 상태는 유지됩니다.
            </p>
            <p className="owner-muted">{status.message}</p>
            <p className="verification-status">심사 중 · 등록 권한 대기</p>
          </section>
        ) : needsForm ? (
          <section className="verification-card">
            <div className="verification-step">
              <ShieldCheck size={24} />
              <span>1. 건물과 신청자 정보</span>
              <span>2. 자료 확인</span>
              <span>3. 승인 후 방 등록</span>
            </div>
            <h2>
              {status.status === 'not_submitted' ? '집주인 인증 신청' : '확인할 정보가 있어요'}
            </h2>
            {status.message && <p role="status">{status.message}</p>}
            <p className="owner-muted">
              본인 명의의 건물만 신청해 주세요. 공동명의·법인 등 별도 확인이 필요한 경우 관리자
              검토로 이어집니다.
            </p>
            <form className="verification-form" onSubmit={submit}>
              <label htmlFor="owner-name">등기상 소유자 이름</label>
              <input
                id="owner-name"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                maxLength={80}
                required
                placeholder="등기사항증명서에 적힌 이름"
                autoComplete="name"
              />
              <label htmlFor="building-address">등록할 건물 주소</label>
              <input
                id="building-address"
                value={buildingAddress}
                onChange={(e) => setBuildingAddress(e.target.value)}
                maxLength={200}
                required
                placeholder="도로명 주소와 건물번호를 입력해 주세요"
              />
              <label htmlFor="owner-proof">건물 등기사항증명서</label>
              <input
                id="owner-proof"
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                onChange={(e) => setProof(e.target.files?.[0] ?? null)}
                required
              />
              <p className="owner-muted">
                PDF·JPG·PNG, 최대 5MB. 필요 없는 주민등록번호 등은 가리고 제출해 주세요.
              </p>
              <label className="verification-consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />{' '}
                인증 자료의 확인과 심사에 동의합니다.
              </label>
              {error && (
                <p className="inline-error" role="alert">
                  {error}
                </p>
              )}
              <button className="btn primary" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}{' '}
                심사 신청하기 <ArrowRight size={16} />
              </button>
            </form>
          </section>
        ) : null}
        <div className="verification-help">
          <strong>어떻게 심사하나요?</strong>
          <p>
            AI는 서류의 이름·주소·누락 항목을 확인하는 데 도움을 줍니다. 실제 소유·등록 권한은
            독립적인 확인과 관리자 심사를 거쳐 결정돼요.
          </p>
        </div>
      </main>
    </>
  );
}
