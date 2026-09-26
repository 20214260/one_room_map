'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { KeyRound, ArrowRight } from 'lucide-react';
import { useApp } from '../../shared/AppProvider';
import { Header } from '../../shared/Header';

export function LandlordGuard({ children }: { children: ReactNode }) {
  const { user, authLoading, authError, config, api } = useApp();
  const [checked, setChecked] = useState<{
    userId: string;
    status: 'approved' | 'required' | 'error';
  } | null>(null);
  const verification = checked && checked.userId === user?.id ? checked.status : 'loading';
  useEffect(() => {
    if (!user || user.role !== 'landlord') return;
    const controller = new AbortController();
    api
      .getOwnerVerification(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted)
          setChecked({
            userId: user.id,
            status: result.status === 'approved' ? 'approved' : 'required',
          });
      })
      .catch(() => {
        if (!controller.signal.aborted) setChecked({ userId: user.id, status: 'error' });
      });
    return () => controller.abort();
  }, [api, user]);
  return (
    <>
      <Header />
      {authLoading || (user?.role === 'landlord' && verification === 'loading') ? (
        <main className="owner-shell" aria-busy="true">
          <p>계정을 확인하고 있어요…</p>
        </main>
      ) : user?.role === 'landlord' && verification === 'approved' ? (
        children
      ) : user?.role === 'landlord' ? (
        <main className="owner-shell">
          <section className="owner-gate">
            <span className="owner-icon">
              <KeyRound size={28} />
            </span>
            <p className="eyebrow">BUILDING ACCESS</p>
            <h1>
              방을 등록하기 전에
              <br />
              권한을 확인해요.
            </h1>
            <p>
              {verification === 'error'
                ? '인증 상태를 불러오지 못했어요. 서버 연결을 확인하고 다시 시도해 주세요.'
                : '집주인 인증 신청과 심사 상태를 확인할 수 있어요.'}
            </p>
            <Link className="btn primary" href="/landlord/verify">
              집주인 인증 확인하기 <ArrowRight size={17} />
            </Link>
          </section>
        </main>
      ) : (
        <main className="owner-shell">
          <section className="owner-gate">
            <span className="owner-icon">
              <KeyRound size={28} />
            </span>
            <p className="eyebrow">FOR YOUR NEXT TENANT</p>
            <h1>
              좋은 방과 새로운 시작을
              <br />
              이어 주세요.
            </h1>
            <p>
              {authError ||
                (user
                  ? '매물 등록과 관리는 집주인 계정에서 이용할 수 있어요.'
                  : '집주인으로 가입하고 사진 몇 장과 기본 정보로 방을 소개해 보세요.')}
            </p>
            <Link className="btn primary" href="/login?returnTo=%2Flandlord">
              {config.mode === 'mock' ? '집주인으로 체험하기' : '집주인 로그인 · 회원가입'}
              <ArrowRight size={17} />
            </Link>
            <Link className="back-link" href="/">
              방 찾기로 돌아가기
            </Link>
          </section>
        </main>
      )}
    </>
  );
}
