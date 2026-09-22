'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LoaderCircle } from 'lucide-react';
import { useApp } from '../../shared/AppProvider';
import { safeReturnPath } from '../../domain/rooms';
export function AuthCallback() {
  const { api, setUser } = useApp();
  const router = useRouter();
  const [error, setError] = useState('');
  useEffect(() => {
    const c = new AbortController();
    const params = new URLSearchParams(location.search);
    if (params.has('error')) {
      setError(
        params.get('error') === 'access_denied'
          ? '로그인이 취소되었어요.'
          : '로그인을 완료하지 못했어요. 다시 시도해 주세요.',
      );
      return;
    }
    api
      .me(c.signal)
      .then((u) => {
        if (!u) {
          setError('로그인 상태를 확인하지 못했어요. 다시 로그인해 주세요.');
          return;
        }
        setUser(u);
        router.replace(safeReturnPath(params.get('returnTo')));
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [api]);
  return (
    <main className="callback-screen">
      {error ? (
        <>
          <h1>로그인을 다시 시도해 주세요</h1>
          <p role="alert">{error}</p>
          <Link className="btn primary" href="/login">
            로그인 화면으로
          </Link>
        </>
      ) : (
        <>
          <LoaderCircle className="spin" />
          <h1>로그인을 확인하고 있어요</h1>
        </>
      )}
    </main>
  );
}
