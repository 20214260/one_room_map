'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowUpRight, House, LogOut, MapPin, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from './AppProvider';
export function Header() {
  const router = useRouter();
  const { selected, user, setUser, api, filters } = useApp();
  const path = usePathname();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!user) return;
    let active = true;
    const update = () => {
      if (document.visibilityState === 'visible')
        api
          .listChats()
          .then((r) => {
            if (active) setUnread(r.items.reduce((n, item) => n + item.unreadCount, 0));
          })
          .catch(() => {});
    };
    update();
    const timer = setInterval(update, 12000);
    window.addEventListener('sunroom:chat-changed', update);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('sunroom:chat-changed', update);
    };
  }, [api, user]);
  return (
    <header className="site-header">
      <Link href="/" className="brand" aria-label="순룸 홈">
        <span className="brand-mark">
          <House size={24} strokeWidth={2.5} />
        </span>
        <strong>
          순룸<span>sunroom</span>
        </strong>
      </Link>
      <nav aria-label="주요 메뉴">
        <Link className={path === '/' ? 'active' : ''} href="/">
          방 찾기
        </Link>
        <Link
          className={path === '/compare' ? 'active' : ''}
          href={`/compare${selected.length ? `?ids=${selected.join(',')}&filters=${encodeURIComponent(JSON.stringify(filters))}` : ''}`}
        >
          방 비교 {selected.length > 0 && <span className="nav-count">{selected.length}</span>}
        </Link>
      </nav>
      <div className="header-right">
        {user && (
          <Link
            className={`chat-header-link ${path === '/chats' ? 'active' : ''}`}
            href="/chats"
            aria-label={`채팅${unread ? `, 읽지 않은 메시지 ${unread}개` : ''}`}
          >
            <MessageCircle size={17} />
            <span>채팅</span>
            {unread > 0 && <b>{unread > 99 ? '99+' : unread}</b>}
          </Link>
        )}
        <Link className="owner-header-link" href="/landlord">
          {user?.role === 'landlord' ? '내 매물 관리' : '방 등록'}
        </Link>
        <span className="campus">
          <MapPin size={16} /> 순천대학교
        </span>
        {user ? (
          <button
            className="login-link"
            onClick={async () => {
              try {
                await api.logout();
                setUser(null);
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            <span className="owner-session-name">{user.name}</span>
            <LogOut size={16} />
          </button>
        ) : (
          <Link
            className="login-link"
            href={`/login?returnTo=${encodeURIComponent(path || '/')}`}
            onClick={(e) => {
              e.preventDefault();
              router.push(
                `/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`,
              );
            }}
          >
            로그인 <ArrowUpRight size={16} />
          </Link>
        )}
      </div>
    </header>
  );
}
