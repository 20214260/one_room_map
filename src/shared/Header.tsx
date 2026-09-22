'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowUpRight, House, LogOut, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from './AppProvider';
export function Header() {
  const router = useRouter();
  const { selected, user, setUser, api, filters } = useApp();
  const path = usePathname();
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
            {user.name}
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
