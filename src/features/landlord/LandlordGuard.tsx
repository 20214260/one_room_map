'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { KeyRound, ArrowRight } from 'lucide-react';
import { useApp } from '../../shared/AppProvider';
import { Header } from '../../shared/Header';

export function LandlordGuard({ children }: { children: ReactNode }) {
  const { user, authLoading, authError, config } = useApp();
  return (
    <>
      <Header />
      {authLoading ? (
        <main className="owner-shell" aria-busy="true">
          <p>계정을 확인하고 있어요…</p>
        </main>
      ) : user?.role === 'landlord' ? (
        children
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
