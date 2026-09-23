'use client';
import { track } from '../../services/analytics';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { House, ArrowRight, LoaderCircle, MessageCircle, ArrowLeft } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useApp } from '../../shared/AppProvider';
import { RegisterSchema, type Role } from '../../contracts/schemas';
import { safeReturnPath } from '../../domain/rooms';
import { Header } from '../../shared/Header';
export function AuthScreen() {
  const { api, setUser, config } = useApp();
  const router = useRouter();
  const [role, setRole] = useState<Role>('seeker');
  const [tab, setTab] = useState('login'),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [agreed, setAgreed] = useState(false),
    [busy, setBusy] = useState(false),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [message, setMessage] = useState(''),
    [terms, setTerms] = useState(false);
  const returnTo = () => safeReturnPath(new URLSearchParams(location.search).get('returnTo'));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    setErrors({});
    if (tab === 'register') {
      const valid = RegisterSchema.safeParse({ email, password, confirmation, agreed, role });
      if (!valid.success) {
        const next: Record<string, string> = {};
        valid.error.issues.forEach((i) => (next[String(i.path[0])] = i.message));
        setErrors(next);
        return;
      }
    } else {
      const next: Record<string, string> = {};
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = '이메일 주소를 확인해 주세요.';
      if (!password) next.password = '비밀번호를 입력해 주세요.';
      if (Object.keys(next).length) {
        setErrors(next);
        return;
      }
    }
    setBusy(true);
    try {
      const user =
        tab === 'register'
          ? await api.register(email.trim(), password, role)
          : await api.login(email.trim(), password);
      setUser(user);
      track('login_success');
      setPassword('');
      setConfirmation('');
      router.replace(user.role === 'landlord' && returnTo() === '/' ? '/landlord' : returnTo());
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function oauth(provider: 'kakao' | 'google') {
    setBusy(true);
    setMessage('');
    try {
      location.assign(await api.oauth(provider, returnTo()));
    } catch (e) {
      setMessage((e as Error).message);
      setBusy(false);
    }
  }
  async function demo(nextRole: Role) {
    setBusy(true);
    setMessage('');
    try {
      const user = await api.demoLogin(nextRole);
      setUser(user);
      router.replace(
        nextRole === 'landlord'
          ? '/landlord'
          : returnTo().startsWith('/landlord')
            ? '/'
            : returnTo(),
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Header />
      <main className="auth-shell">
        <div className="auth-story">
          <span className="auth-mark">
            <House size={36} />
          </span>
          <p className="eyebrow">순천대 앞, 나의 첫 공간</p>
          <h1>
            나의 하루가
            <br />
            시작되는 방.
          </h1>
          <p>
            월세부터 통학 거리까지.
            <br />첫 자취의 고민을 순룸과 함께 풀어보세요.
          </p>
          <div className="auth-photo">
            <img src="/images/room-1.jpg" alt="따뜻한 분위기의 스튜디오 참고 사진" />
            <span>Make room for your life.</span>
          </div>
        </div>
        <section className="auth-card">
          <Link className="back-link" href="/">
            <ArrowLeft size={16} />
            비회원으로 둘러보기
          </Link>
          <h2>{tab === 'register' ? '순룸에 오신 걸 환영해요' : '다시 만나 반가워요'}</h2>
          <p>로그인 없이도 탐색과 비교를 이용할 수 있어요.</p>
          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v);
              setErrors({});
              setMessage('');
            }}
          >
            <TabsList className="auth-tabs">
              <TabsTrigger value="login">로그인</TabsTrigger>
              <TabsTrigger value="register">회원가입</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="social-buttons">
            <button className="kakao-login" disabled={busy} onClick={() => oauth('kakao')}>
              <MessageCircle size={19} fill="currentColor" />
              카카오로 계속하기
            </button>
            <button className="google-login" disabled={busy} onClick={() => oauth('google')}>
              <b className="google-g">G</b>Google로 계속하기
            </button>
          </div>
          <div className="or-divider">
            <span>또는 이메일로</span>
          </div>
          <form noValidate onSubmit={submit}>
            {tab === 'register' && (
              <fieldset className="owner-role-select">
                <legend>어떻게 순룸을 이용하실 건가요?</legend>
                <div>
                  {(['seeker', 'landlord'] as const).map((value) => (
                    <label key={value} className={role === value ? 'chosen' : ''}>
                      <input
                        type="radio"
                        name="role"
                        value={value}
                        checked={role === value}
                        onChange={() => setRole(value)}
                        disabled={busy}
                      />
                      <span>
                        <strong>{value === 'seeker' ? '방을 구해요' : '방을 내놓아요'}</strong>
                        <small>
                          {value === 'seeker'
                            ? '내 조건에 맞는 방 찾기'
                            : '집주인 · 매물 등록과 관리'}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <label htmlFor="email">이메일</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              maxLength={254}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'email-error' : undefined}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="hello@example.com"
            />
            {errors.email && (
              <p id="email-error" className="field-error">
                {errors.email}
              </p>
            )}
            <label htmlFor="password">비밀번호</label>
            <input
              id="password"
              type="password"
              autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
              value={password}
              maxLength={72}
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'password-error' : undefined}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={
                tab === 'register' ? '영문·숫자 포함 8자 이상' : '비밀번호를 입력해 주세요'
              }
            />
            {errors.password && (
              <p id="password-error" className="field-error">
                {errors.password}
              </p>
            )}
            {tab === 'register' && (
              <>
                <label htmlFor="confirmation">비밀번호 확인</label>
                <input
                  id="confirmation"
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  maxLength={72}
                  aria-invalid={!!errors.confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  placeholder="비밀번호를 한 번 더 입력해 주세요"
                />
                {errors.confirmation && <p className="field-error">{errors.confirmation}</p>}
                <div className="terms-check">
                  <Checkbox
                    id="terms"
                    checked={agreed}
                    onCheckedChange={(v) => setAgreed(v === true)}
                  />
                  <label htmlFor="terms">[필수] 서비스 이용약관·개인정보 처리 안내 동의</label>
                  <button type="button" onClick={() => setTerms(true)}>
                    보기
                  </button>
                </div>
                {errors.agreed && <p className="field-error">{errors.agreed}</p>}
              </>
            )}
            {message && (
              <p className="inline-error" role="alert">
                {message}
              </p>
            )}
            <button className="btn primary auth-submit" disabled={busy}>
              {busy ? <LoaderCircle size={17} className="spin" /> : null}
              {tab === 'register' ? '회원가입하고 시작하기' : '로그인'}
              <ArrowRight size={17} />
            </button>
          </form>
          {config.mode === 'mock' && (
            <div className="owner-demo-login">
              <strong>가입 없이, 두 역할로 체험해 보세요</strong>
              <div>
                <button type="button" disabled={busy} onClick={() => demo('seeker')}>
                  사용자로 체험
                </button>
                <button type="button" disabled={busy} onClick={() => demo('landlord')}>
                  집주인으로 체험 <ArrowRight size={15} />
                </button>
              </div>
              <p>
                실제 계정·메시지 전송 없이 동작하는 시연이에요. 같은 탭에서 역할을 바꾸면 등록
                매물과 문의를 확인할 수 있어요. 비밀번호는 저장하지 않아요.
              </p>
            </div>
          )}
        </section>
      </main>
      <Dialog open={terms} onOpenChange={setTerms}>
        <DialogContent>
          <DialogTitle>서비스 이용 안내 · 시연용 초안</DialogTitle>
          <DialogDescription>정식 서비스 전 운영 주체의 검토와 확정이 필요해요.</DialogDescription>
          <div className="terms-copy">
            <p>
              순룸은 매물 정보 비교를 돕는 서비스이며 계약·중개 기능은 제공하지 않습니다. 샘플
              화면의 매물은 실제 거래 대상이 아닙니다.
            </p>
            <p>
              정식 계정 연결 시 이메일, 제공자 식별자와 로그인 기록을 계정 관리 목적으로 처리할
              예정입니다. 현재 시연은 임시 사용자 정보와 매물을 이 탭의 세션 저장소에 보관합니다.
              비밀번호는 저장·전송하지 않으며 탭을 닫으면 시연 데이터는 사라집니다. 실제 개인정보는
              입력하지 마세요.
            </p>
            <p>
              개인정보 처리 주체, 보유 기간, 문의처 및 이용자 권리 안내는 실제 회원가입 공개 전에
              확정해야 합니다.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
