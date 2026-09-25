'use client';
import { useEffect, useRef, useState } from 'react';
import { MapPin, GraduationCap } from 'lucide-react';
import type { Room } from '../../contracts/schemas';
import { useApp } from '../../shared/AppProvider';
import { createLocationPicker } from '../maps/kakao';

export function LocationPicker({
  value,
  onChange,
}: {
  value: Room['coordinates'];
  onChange: (p: Room['coordinates']) => void;
}) {
  const { config } = useApp();
  const element = useRef<HTMLDivElement>(null);
  const view = useRef<Awaited<ReturnType<typeof createLocationPicker>> | null>(null);
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  }, [value, onChange]);
  const [error, setError] = useState(''),
    [ready, setReady] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!config.kakaoMapKey || !element.current) return;
    let active = true;
    setError('');
    setReady(false);
    createLocationPicker(element.current, config.kakaoMapKey, latest.current.value, (p) =>
      latest.current.onChange(p),
    )
      .then((v) => {
        if (!active) {
          v.destroy();
          return;
        }
        view.current = v;
        setReady(true);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      view.current?.destroy();
      view.current = null;
    };
  }, [config.kakaoMapKey, attempt]);
  useEffect(() => {
    view.current?.set(value);
  }, [value]);
  const sample = !config.kakaoMapKey && config.mode === 'mock';
  const x = value ? Math.max(3, Math.min(97, ((value.lng - 127.475) / 0.013) * 100)) : 50;
  const y = value ? Math.max(3, Math.min(97, ((34.975 - value.lat) / 0.01) * 100)) : 50;
  return (
    <div className="owner-location">
      {sample ? (
        <>
          <button
            type="button"
            className="owner-sample-map"
            aria-label="시연 지도에서 위치 선택"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const px = e.detail === 0 ? 0.5 : (e.clientX - rect.left) / rect.width;
              const py = e.detail === 0 ? 0.5 : (e.clientY - rect.top) / rect.height;
              onChange({
                lat: Number((34.975 - py * 0.01).toFixed(6)),
                lng: Number((127.475 + px * 0.013).toFixed(6)),
              });
            }}
            onKeyDown={(e) => {
              if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
              e.preventDefault();
              const p = value ?? { lat: 34.9709, lng: 127.4806 };
              onChange({
                lat: Math.max(
                  34.965,
                  Math.min(
                    34.975,
                    p.lat + (e.key === 'ArrowUp' ? 0.0001 : e.key === 'ArrowDown' ? -0.0001 : 0),
                  ),
                ),
                lng: Math.max(
                  127.475,
                  Math.min(
                    127.488,
                    p.lng + (e.key === 'ArrowRight' ? 0.0001 : e.key === 'ArrowLeft' ? -0.0001 : 0),
                  ),
                ),
              });
            }}
          >
            <span className="owner-map-campus">
              <GraduationCap size={28} />
              순천대학교
            </span>
            <span className="owner-map-road">정문 생활권</span>
            <span className="owner-map-road back">후문 생활권</span>
            {value && (
              <span className="owner-map-pin" style={{ left: `${x}%`, top: `${y}%` }}>
                <MapPin size={28} fill="currentColor" />
                <b>선택한 위치</b>
              </span>
            )}
            <span className="owner-map-caption">실제 지도 아님 · 클릭 또는 방향키로 핀 이동</span>
          </button>
          <div className="owner-location-presets">
            <button type="button" onClick={() => onChange({ lat: 34.9716, lng: 127.4801 })}>
              정문 주변 선택
            </button>
            <button type="button" onClick={() => onChange({ lat: 34.9702, lng: 127.4849 })}>
              후문 주변 선택
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="owner-real-map" ref={element} />
          {!config.kakaoMapKey ? (
            <p role="alert">지도 키를 설정한 뒤 실제 위치를 선택할 수 있어요.</p>
          ) : error ? (
            <p role="alert">
              {error}
              <button type="button" onClick={() => setAttempt((a) => a + 1)}>
                다시 시도
              </button>
            </p>
          ) : !ready ? (
            <p role="status">지도를 불러오는 중…</p>
          ) : (
            <p className="owner-muted">방이 있는 위치를 지도에서 클릭해 주세요.</p>
          )}
        </>
      )}
      {value && (
        <p className="owner-coordinate">
          선택 위치 {value.lat.toFixed(5)}, {value.lng.toFixed(5)} {sample && '· 시연 좌표'}
          <button type="button" onClick={() => onChange(null)}>
            다시 선택
          </button>
        </p>
      )}
    </div>
  );
}
