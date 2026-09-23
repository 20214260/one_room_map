'use client';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ImagePlus,
  LoaderCircle,
  MapPin,
  Save,
  Sparkles,
  X,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useApp } from '../../shared/AppProvider';
import { LandlordGuard } from './LandlordGuard';
import { LocationPicker } from './LocationPicker';
import { optionIds, optionLabels, type RoomSubmission } from '../../contracts/schemas';
import type { DraftResponse } from '../../contracts/landlord';
import { money } from '../../domain/rooms';
import { preparePhoto } from '../../services/photos';
import { RoomPhoto } from '../../shared/RoomPhoto';
import {
  EditorFormSchema,
  emptyForm,
  fromSubmission,
  amountFromMan,
  validateForm,
  previewRoom,
  type EditorForm,
} from './editor-form';

export function ListingEditor({ editing = false }: { editing?: boolean }) {
  return (
    <LandlordGuard>
      <Editor editing={editing} />
    </LandlordGuard>
  );
}
function Editor({ editing }: { editing: boolean }) {
  const { api, config, user } = useApp();
  const [form, setForm] = useState<EditorForm>(emptyForm);
  const [step, setStep] = useState(0),
    [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(''),
    [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false),
    [photoBusy, setPhotoBusy] = useState(false),
    [draftBusy, setDraftBusy] = useState(false);
  const [pasted, setPasted] = useState(''),
    [draft, setDraft] = useState<DraftResponse | null>(null),
    [approved, setApproved] = useState(false);
  const [saved, setSaved] = useState(''),
    [resume, setResume] = useState<EditorForm | null>(null);
  const [result, setResult] = useState<{ roomId: string; status: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const rowId = useRef(''),
    draftKey = useRef('');
  const heading = useRef<HTMLHeadingElement>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  function change<K extends keyof EditorForm>(key: K, value: EditorForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setApproved(false);
    setErrors((prev) => ({ ...prev, [key]: '' }));
  }
  useEffect(() => {
    const c = new AbortController();
    rowId.current = editing ? (new URLSearchParams(location.search).get('id') ?? '') : '';
    draftKey.current = `sunroom.editor.v1.${user!.id}.${rowId.current || 'new'}`;
    async function initialize() {
      await Promise.resolve();
      if (c.signal.aborted) return;
      setLoading(true);
      setLoadError('');
      if (config.mode === 'mock') {
        try {
          const raw = sessionStorage.getItem(draftKey.current);
          if (raw) setResume(EditorFormSchema.parse(JSON.parse(raw)));
        } catch {
          /* An invalid draft never replaces the server response. */
        }
      }
      if (!editing) {
        setLoading(false);
        return;
      }
      api
        .myRooms(c.signal)
        .then(({ items }) => {
          if (c.signal.aborted) return;
          const row = items.find((r) => r.id === rowId.current);
          if (!row) throw new Error('수정할 매물을 찾을 수 없거나 접근 권한이 없어요.');
          setForm(fromSubmission(row.submission));
        })
        .catch((e) => {
          if (!c.signal.aborted) setLoadError(e.message);
        })
        .finally(() => {
          if (!c.signal.aborted) setLoading(false);
        });
    }
    void initialize();
    return () => c.abort();
  }, [api, editing, user, config.mode, attempt]);
  useEffect(() => {
    if (loading || !dirty || result || config.mode !== 'mock') return;
    const t = setTimeout(() => {
      try {
        sessionStorage.setItem(draftKey.current, JSON.stringify(form));
        setSaved('이 탭에 임시저장됨');
      } catch {
        setSaved('임시저장 공간 부족 · 사진 수를 줄여 주세요');
      }
    }, 700);
    return () => clearTimeout(t);
  }, [form, loading, dirty, result, config.mode]);
  useEffect(() => {
    if (!dirty || result) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, result]);
  const errorFor = (key: string) =>
    errors[key] ? (
      <small className="field-error" id={`error-${key}`} role="alert">
        {errors[key]}
      </small>
    ) : null;
  function checkNext() {
    const checked = validateForm(form, step > 0);
    setErrors(checked.errors);
    if (Object.keys(checked.errors).length) {
      toast.error('입력 내용을 확인해 주세요.');
      return;
    }
    setStep((s) => Math.min(2, s + 1));
    heading.current?.focus();
  }
  async function photos(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    if (files.length + form.photos.length > 10) {
      toast.error('사진은 최대 10장까지 올릴 수 있어요.');
      return;
    }
    setPhotoBusy(true);
    try {
      const uploaded: EditorForm['photos'] = [];
      for (const file of files)
        uploaded.push((await api.uploadPhoto(await preparePhoto(file))).photo);
      if (active.current) {
        setForm((prev) => ({ ...prev, photos: [...prev.photos, ...uploaded] }));
        setDirty(true);
        setApproved(false);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      if (active.current) setPhotoBusy(false);
    }
  }
  async function generate() {
    setDraftBusy(true);
    try {
      const req = {
        title: form.title,
        locationHint: { zone: form.zone, detail: form.detail },
        rent: amountFromMan(form.rent) ?? undefined,
        deposit: amountFromMan(form.deposit),
        maintenance: amountFromMan(form.maintenance),
        options: form.options,
        pastedListingText: pasted,
      };
      const generated = await api.generateDraft(req);
      if (active.current) setDraft(generated);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      if (active.current) setDraftBusy(false);
    }
  }
  function applyDraft() {
    if (!draft) return;
    setForm((prev) => {
      const next = { ...prev, description: draft.description };
      for (const key of ['rent', 'deposit', 'maintenance'] as const) {
        const val = draft.hints[key];
        if (!prev[key].trim() && val != null) next[key] = String(val / 10000);
      }
      return next;
    });
    setDirty(true);
    setApproved(false);
    setDraft(null);
    toast.success('초안을 적용했어요. 내용을 자유롭게 수정해 주세요.');
  }
  async function submit() {
    const checked = validateForm(form);
    setErrors(checked.errors);
    if (!checked.input || !approved) {
      toast.error('입력 내용과 최종 확인 항목을 확인해 주세요.');
      return;
    }
    setBusy(true);
    try {
      const input: RoomSubmission = checked.input;
      const r = editing
        ? await api
            .updateRoom(rowId.current, input)
            .then((r) => ({ roomId: r.id, status: r.status }))
        : await api.submitRoom(input);
      setResult(r);
      setDirty(false);
      try {
        sessionStorage.removeItem(draftKey.current);
      } catch {
        /* Save already succeeded. */
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const preview = previewRoom(form);
  if (loading || loadError)
    return (
      <main className="owner-shell">
        <div className="owner-empty">
          {loading ? (
            <>
              <LoaderCircle className="spin" />
              <p>매물을 불러오고 있어요.</p>
            </>
          ) : (
            <>
              <p role="alert">{loadError}</p>
              <button className="btn secondary" onClick={() => setAttempt((n) => n + 1)}>
                다시 시도
              </button>
              <Link href="/landlord">내 매물로 돌아가기</Link>
            </>
          )}
        </div>
      </main>
    );
  if (result)
    return (
      <main className="owner-shell">
        <section className="owner-success">
          <span className="owner-icon">
            <Check size={32} />
          </span>
          <p className="eyebrow">READY FOR A NEW BEGINNING</p>
          <h1>
            {result.status === 'pending_review' ? '검수 요청을 보냈어요.' : '방 정보가 저장됐어요.'}
          </h1>
          <p>
            {result.status === 'published'
              ? '방을 찾는 사람들이 목록과 지도에서 이 방을 살펴볼 수 있어요.'
              : '내 매물 관리에서 현재 상태를 확인할 수 있어요.'}
          </p>
          {config.mode === 'mock' && (
            <p className="owner-demo-note">
              시연용 등록이에요. 실제 서비스에서는 서버 검수를 거쳐 공개됩니다.
            </p>
          )}
          <div className="owner-dialog-actions">
            <Link className="btn primary" href="/landlord">
              내 매물 확인
            </Link>
            <Link className="btn secondary" href="/">
              방 찾기에서 확인 <ArrowUpRightIcon />
            </Link>
          </div>
        </section>
      </main>
    );
  return (
    <main className="owner-shell owner-editor">
      <Link
        className="back-link"
        href="/landlord"
        onClick={(e) => {
          if (
            dirty &&
            !window.confirm(
              '등록을 마치지 않고 나갈까요? 시연 모드의 임시저장은 같은 탭에서 이어 쓸 수 있어요.',
            )
          )
            e.preventDefault();
        }}
      >
        <ArrowLeft size={16} />내 매물 관리
      </Link>
      <div className="owner-editor-title">
        <div>
          <p className="eyebrow">MAKE ROOM FOR SOMEONE</p>
          <h1>{editing ? '방 정보를 다듬어 주세요.' : '당신의 방을 소개해 주세요.'}</h1>
          <p>작은 정보부터 차근차근. 좋은 인연으로 이어질 수 있도록.</p>
        </div>
        <span className="owner-save-state">
          <Save size={15} />
          {saved || (config.mode === 'mock' ? '이 탭에서 임시저장' : '최종 저장 전 미등록')}
        </span>
      </div>
      {config.mode === 'mock' && (
        <p className="owner-demo-note">
          시연용으로만 입력해 주세요. 사진·연락처·매물 정보는 이 탭에 보관되며 탭을 닫으면 사라져요.
        </p>
      )}
      {resume && (
        <div className="owner-resume">
          <span>이전에 작성하던 내용이 있어요.</span>
          <button
            type="button"
            onClick={() => {
              setForm(resume);
              setDirty(true);
              setResume(null);
            }}
          >
            이어서 작성
          </button>
          <button
            type="button"
            onClick={() => {
              setResume(null);
              try {
                sessionStorage.removeItem(draftKey.current);
              } catch {
                /* no-op */
              }
            }}
          >
            버리기
          </button>
        </div>
      )}
      <ol className="owner-steps">
        {['기본 정보와 위치', '사진과 상세 설명', '확인하고 등록'].map((label, index) => (
          <li key={label} className={step === index ? 'current' : step > index ? 'done' : ''}>
            <button
              type="button"
              disabled={index > step || busy || photoBusy || draftBusy}
              onClick={() => setStep(index)}
            >
              <span>{step > index ? <Check size={15} /> : index + 1}</span>
              {label}
            </button>
          </li>
        ))}
      </ol>
      <div className="owner-editor-grid">
        <section className="owner-form-panel">
          <h2 ref={heading} tabIndex={-1}>
            {['어떤 방을 내놓으시나요?', '방의 매력을 더해 주세요.', '이대로 등록할까요?'][step]}
          </h2>
          <p className="owner-muted">
            {
              [
                '별표(*) 항목만 입력하면 시작할 수 있어요.',
                '모르는 정보는 비워 두세요. 없는 것과 모르는 것은 달라요.',
                '가격·사진·설명을 확인해 주세요. 저장 후에도 수정할 수 있어요.',
              ][step]
            }
          </p>
          <fieldset className="owner-fields" disabled={busy || photoBusy || draftBusy}>
            {step === 0 && (
              <>
                <label className="owner-field">
                  매물 제목 *
                  <input
                    name="title"
                    value={form.title}
                    maxLength={60}
                    onChange={(e) => change('title', e.target.value)}
                    placeholder="예: 순천대 정문 근처 풀옵션 원룸"
                    aria-invalid={!!errors.title}
                  />
                  {errorFor('title')}
                </label>
                <div className="owner-field-row">
                  <label className="owner-field">
                    월세 (만원) *
                    <input
                      name="rent"
                      inputMode="decimal"
                      value={form.rent}
                      onChange={(e) => change('rent', e.target.value)}
                      placeholder="예: 32"
                      aria-invalid={!!errors.rent}
                    />
                    {errorFor('rent')}
                  </label>
                  <label className="owner-field">
                    생활권
                    <select
                      value={form.zone}
                      onChange={(e) => change('zone', e.target.value as EditorForm['zone'])}
                    >
                      <option value="front-gate">정문 생활권</option>
                      <option value="back-gate">후문 생활권</option>
                      <option value="other">그 외 주변</option>
                    </select>
                  </label>
                </div>
                <label className="owner-field">
                  주변 위치 설명 *
                  <input
                    name="detail"
                    value={form.detail}
                    maxLength={60}
                    onChange={(e) => change('detail', e.target.value)}
                    placeholder="예: 석현동, 정문 맞은편 골목"
                    aria-invalid={!!errors.detail}
                  />
                  <small>목록에 공개되는 설명이에요. 상세 호수·개인정보는 적지 마세요.</small>
                  {errorFor('detail')}
                </label>
                <div className="owner-field">
                  <span>지도에서 위치 선택 *</span>
                  <LocationPicker
                    value={form.coordinates ?? null}
                    onChange={(p) => change('coordinates', p)}
                  />
                  {errorFor('coordinates')}
                </div>
                <div className="owner-private-note">
                  <ShieldCheck size={18} />
                  <div>
                    <strong>연락처는 공개하지 않아요.</strong>
                    <p>문의 중계용으로 사용하며 매물 목록·상세에 노출하지 않아요.</p>
                  </div>
                </div>
                <div className="owner-field-row">
                  <label className="owner-field">
                    연락 방법 *
                    <select
                      value={form.contactMethod}
                      onChange={(e) =>
                        change('contactMethod', e.target.value as EditorForm['contactMethod'])
                      }
                    >
                      <option value="phone">전화번호</option>
                      <option value="kakao">카카오 오픈채팅</option>
                    </select>
                  </label>
                  <label className="owner-field">
                    {form.contactMethod === 'phone' ? '전화번호' : '오픈채팅 링크'} *
                    <input
                      name="contactValue"
                      value={form.contactValue}
                      maxLength={100}
                      onChange={(e) => change('contactValue', e.target.value)}
                      placeholder={
                        form.contactMethod === 'phone'
                          ? '010-0000-0000'
                          : 'https://open.kakao.com/...'
                      }
                      aria-invalid={!!errors.contactValue}
                    />
                    {errorFor('contactValue')}
                  </label>
                </div>
              </>
            )}
            {step === 1 && (
              <>
                <div className="owner-field">
                  <span>
                    방 사진 <small>{form.photos.length}/10</small>
                  </span>
                  <label className="owner-upload">
                    <ImagePlus size={26} />
                    <strong>
                      {photoBusy ? '사진을 준비하고 있어요…' : '방의 모습을 보여 주세요'}
                    </strong>
                    <span>JPG · PNG · WEBP / 장당 최대 5MB</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      onChange={photos}
                      aria-label="방 사진 업로드"
                    />
                  </label>
                  {form.photos.length > 0 && (
                    <div className="owner-photo-grid">
                      {form.photos.map((photo, i) => (
                        <div key={`${i}-${photo.url.slice(-20)}`}>
                          <img src={photo.url} alt={photo.alt} />
                          <button
                            type="button"
                            className="owner-photo-remove"
                            aria-label={`사진 ${i + 1} 삭제`}
                            onClick={() =>
                              change(
                                'photos',
                                form.photos.filter((_, index) => index !== i),
                              )
                            }
                          >
                            <X size={14} />
                          </button>
                          <button
                            type="button"
                            className="owner-photo-cover"
                            onClick={() =>
                              change('photos', [
                                photo,
                                ...form.photos.filter((_, index) => index !== i),
                              ])
                            }
                          >
                            {i === 0 ? '대표 사진' : '대표로 설정'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {errorFor('photos')}
                </div>
                <div className="owner-field-row">
                  {(['deposit', 'maintenance', 'area', 'floor'] as const).map((key) => (
                    <label key={key} className="owner-field">
                      {
                        {
                          deposit: '보증금 (만원)',
                          maintenance: '관리비 (만원)',
                          area: '전용 면적 (m²)',
                          floor: '층수',
                        }[key]
                      }
                      <input
                        name={key}
                        inputMode={key === 'floor' ? 'text' : 'decimal'}
                        value={form[key]}
                        onChange={(e) => change(key, e.target.value)}
                        placeholder="미입력 시 정보 없음"
                        aria-invalid={!!errors[key]}
                      />
                      {errorFor(key)}
                    </label>
                  ))}
                </div>
                <div className="owner-field">
                  <span>제공 옵션</span>
                  <div className="owner-options">
                    {optionIds.map((key) => (
                      <label key={key}>
                        {optionLabels[key]}
                        <select
                          aria-label={`${optionLabels[key]} 제공 여부`}
                          value={
                            form.options?.[key] === undefined
                              ? 'unknown'
                              : String(form.options[key])
                          }
                          onChange={(e) => {
                            const options = { ...form.options };
                            if (e.target.value === 'unknown') delete options[key];
                            else options[key] = e.target.value === 'true';
                            change('options', options);
                          }}
                        >
                          <option value="unknown">미확인</option>
                          <option value="true">있음</option>
                          <option value="false">없음</option>
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="owner-ai-box">
                  <span className="owner-ai-label">
                    <Sparkles size={18} />
                    {config.mode === 'mock'
                      ? '소개글 작성 도우미 · 기본 초안'
                      : 'AI 소개글 작성 도우미'}
                  </span>
                  <h3>입력한 정보로, 소개글을 간편하게.</h3>
                  <p>기존 게시글이 있다면 붙여 넣으세요. 금액 제안을 확인한 뒤 적용할 수 있어요.</p>
                  <label className="owner-field">
                    <span className="sr-only">기존 게시글</span>
                    <textarea
                      value={pasted}
                      onChange={(e) => setPasted(e.target.value)}
                      maxLength={2000}
                      rows={3}
                      placeholder="예: 보증금 300만원, 월세 32만원, 관리비 5만원…"
                    />
                  </label>
                  <button type="button" className="btn secondary" onClick={generate}>
                    {draftBusy ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <Sparkles size={16} />
                    )}
                    초안 만들기
                  </button>
                  <small>
                    붙여 넣은 원문은 임시저장하지 않아요. 확인되지 않은 사실은 추정하지 않아요.
                  </small>
                </div>
                <label className="owner-field">
                  상세 설명
                  <textarea
                    name="description"
                    rows={7}
                    value={form.description}
                    maxLength={1000}
                    onChange={(e) => change('description', e.target.value)}
                    placeholder="방의 특징과 관리비 포함 항목, 입주 가능일 등 확인된 정보를 자유롭게 적어 주세요."
                  />
                  <small>
                    {form.description.length}/1,000자 · 자동작성 후에도 직접 수정할 수 있어요.
                  </small>
                  {errorFor('description')}
                </label>
              </>
            )}
            {step === 2 && (
              <>
                <div className="owner-review">
                  <h3>{form.title}</h3>
                  <p>
                    <MapPin size={15} />
                    {form.detail}
                  </p>
                  <dl>
                    {[
                      ['보증금', money(preview.deposit)],
                      ['월세', money(preview.rent)],
                      ['관리비', money(preview.maintenance)],
                      ['전용 면적', form.area ? `${form.area}m²` : '정보 없음'],
                      ['층수', form.floor ? `${form.floor}층` : '정보 없음'],
                      ['사진', `${form.photos.length}장`],
                    ].map(([key, val]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{val}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="owner-review-description">
                    {form.description || '등록된 상세 설명 없음'}
                  </p>
                </div>
                <p className="owner-private-note">
                  <ShieldCheck size={19} />
                  연락처는 공개 목록에 표시되지 않아요.
                </p>
                <label className="owner-confirm">
                  <input
                    type="checkbox"
                    checked={approved}
                    onChange={(e) => setApproved(e.target.checked)}
                  />
                  <span>
                    사진과 설명, 금액이 정확한지 확인했으며 이 매물을 등록할 권한이 있습니다.
                  </span>
                </label>
                {Object.values(errors)
                  .filter(Boolean)
                  .map((message, i) => (
                    <p className="field-error" key={i}>
                      {message}
                    </p>
                  ))}
              </>
            )}
          </fieldset>
          <div className="owner-editor-actions">
            {step > 0 && (
              <button
                type="button"
                className="btn secondary"
                disabled={busy || photoBusy || draftBusy}
                onClick={() => setStep((s) => s - 1)}
              >
                <ArrowLeft size={16} />
                이전
              </button>
            )}
            {step < 2 ? (
              <button
                type="button"
                className="btn primary"
                disabled={photoBusy || draftBusy}
                onClick={checkNext}
              >
                다음으로 <ArrowRight size={17} />
              </button>
            ) : (
              <button
                type="button"
                className="btn primary"
                disabled={!approved || busy}
                onClick={submit}
              >
                {busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}
                {editing ? '수정 내용 저장' : '매물 등록하기'}
              </button>
            )}
          </div>
        </section>
        <aside className="owner-preview">
          <p className="eyebrow">LISTING PREVIEW</p>
          <h3>학생에게 이렇게 보여요</h3>
          <div className="owner-preview-card">
            <RoomPhoto key={form.photos[0]?.url || 'empty'} room={preview} />
            <div>
              <span className="owner-muted">{preview.neighborhood}</span>
              <h3>{preview.title}</h3>
              <strong>
                {money(preview.deposit)} / {money(preview.rent)}
              </strong>
              <p>관리비 {money(preview.maintenance)}</p>
              <div className="owner-preview-tags">
                {optionIds
                  .filter((key) => form.options?.[key])
                  .map((key) => (
                    <span key={key}>{optionLabels[key]}</span>
                  ))}
              </div>
            </div>
          </div>
          <p className="owner-muted">
            입력하지 않은 정보는 ‘정보 없음’으로 표시해요. 사진 첫 장이 대표 이미지예요.
          </p>
          <div className="owner-tip">
            <Sparkles size={19} />
            <strong>작은 디테일이 좋은 선택을 만들어요.</strong>
            <p>방 전체, 주방, 화장실 사진을 함께 올리고 관리비에 포함된 항목을 적어 주세요.</p>
          </div>
        </aside>
      </div>
      <Dialog
        open={!!draft}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
        }}
      >
        <DialogContent className="owner-draft-dialog">
          <DialogTitle>
            {draft?.mode === 'ai' ? 'AI가 작성한 소개글' : '입력한 정보로 만든 기본 초안'}
          </DialogTitle>
          <DialogDescription>
            적용하면 현재 소개글을 교체해요. 금액은 비어 있는 항목만 채우며, 적용 후 수정할 수
            있어요.
          </DialogDescription>
          <p className="owner-review-description">{draft?.description}</p>
          {draft &&
            Object.entries(draft.hints).map(([key, value]) => (
              <p key={key}>
                {{ rent: '월세', deposit: '보증금', maintenance: '관리비' }[key as 'rent']} 제안:{' '}
                {money(value ?? null)}
              </p>
            ))}
          {draft?.limitations.map((text) => (
            <small key={text}>{text}</small>
          ))}
          <div className="owner-dialog-actions">
            <button className="btn secondary" onClick={() => setDraft(null)}>
              취소
            </button>
            <button className="btn primary" onClick={applyDraft}>
              확인하고 적용
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
function ArrowUpRightIcon() {
  return <ArrowRight size={16} />;
}
