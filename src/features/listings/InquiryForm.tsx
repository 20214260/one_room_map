'use client';
import { useState } from 'react';
import Link from 'next/link';
import { LoaderCircle, MessageCircle, Check } from 'lucide-react';
import { useApp } from '../../shared/AppProvider';
import type { Contact } from '../../contracts/schemas';
export function InquiryForm({ roomId }: { roomId: string }) {
  const { api, user, config } = useApp();
  const [message, setMessage] = useState(''),
    [method, setMethod] = useState<Contact['method']>('phone'),
    [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false),
    [error, setError] = useState('');
  return (
    <section className="owner-contact-form">
      <h3>
        <MessageCircle size={18} />
        집주인에게 문의하기
      </h3>
      <p>
        {config.mode === 'mock'
          ? '시연 메시지는 집주인의 받은 문의에만 표시돼요. 실제 연락처를 입력하지 마세요.'
          : '연락처를 공개하지 않고 서버를 통해 문의를 전달해요.'}
      </p>
      {!user ? (
        <Link className="btn secondary" href="/login">
          로그인하고 문의하기
        </Link>
      ) : sent ? (
        <p role="status">
          <Check size={17} />
          {config.mode === 'mock'
            ? '시연 문의가 저장됐어요. 집주인 계정에서 확인할 수 있어요.'
            : '문의가 전달됐어요.'}
        </p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            if (!message.trim()) {
              setError('문의 내용을 입력해 주세요.');
              return;
            }
            if (
              method === 'phone'
                ? !/^0\d{8,10}$/.test(contact.replace(/[-\s]/g, ''))
                : !/^https:\/\/open\.kakao\.com\/[A-Za-z0-9/_-]+$/.test(contact.trim())
            ) {
              setError('답변 받을 연락처 형식을 확인해 주세요.');
              return;
            }
            setBusy(true);
            try {
              const r = await api.inquire({
                roomId,
                message,
                replyContact: { method, value: contact },
              });
              if (r.status !== 'sent')
                throw new Error('문의 전달에 실패했어요. 다시 시도해 주세요.');
              setSent(true);
              setContact('');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="owner-field">
            문의 내용
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={500}
              rows={3}
              required
              placeholder="입주 가능일이나 방문 일정을 물어보세요."
            />
          </label>
          <div className="owner-field-row">
            <label className="owner-field">
              답변 받을 방법
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as Contact['method'])}
              >
                <option value="phone">전화번호</option>
                <option value="kakao">카카오 오픈채팅</option>
              </select>
            </label>
            <label className="owner-field">
              답변 받을 연락처
              <input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                maxLength={100}
                required
                placeholder={method === 'phone' ? '010-0000-0000' : 'https://open.kakao.com/...'}
              />
            </label>
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn primary" disabled={busy}>
            {busy ? <LoaderCircle size={17} className="spin" /> : <MessageCircle size={17} />}문의
            보내기
          </button>
        </form>
      )}
    </section>
  );
}
