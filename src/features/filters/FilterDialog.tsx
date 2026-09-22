'use client';
import { useState } from 'react';
import { Check, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  optionIds,
  optionLabels,
  facilityIds,
  facilityLabels,
  emptyFilters,
  type Filters,
} from '../../contracts/schemas';
import { parseBudget } from '../../domain/rooms';
import { useApp } from '../../shared/AppProvider';
export function FilterDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { filters, setFilters } = useApp();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="filter-dialog">
        <FilterForm
          key={open ? 'open' : 'closed'}
          initial={filters}
          apply={(f) => {
            setFilters(f);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
function FilterForm({ initial, apply }: { initial: Filters; apply: (f: Filters) => void }) {
  const [draft, setDraft] = useState(initial);
  const [budget, setBudget] = useState({
    maxRent: initial.maxRent === null ? '' : String(initial.maxRent / 10000),
    maxMaintenance: initial.maxMaintenance === null ? '' : String(initial.maxMaintenance / 10000),
    maxDeposit: initial.maxDeposit === null ? '' : String(initial.maxDeposit / 10000),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  function submit() {
    const next = { ...draft };
    const e: Record<string, string> = {};
    for (const k of ['maxRent', 'maxMaintenance', 'maxDeposit'] as const) {
      try {
        next[k] = parseBudget(budget[k], k === 'maxDeposit' ? 1000000 : 10000);
      } catch (error) {
        e[k] = (error as Error).message;
      }
    }
    setErrors(e);
    if (!Object.keys(e).length) apply(next);
  }
  return (
    <>
      <div className="dialog-icon">
        <SlidersHorizontal size={22} />
      </div>
      <DialogTitle className="dialog-title">어떤 방을 찾고 있나요?</DialogTitle>
      <DialogDescription>
        꼭 필요한 조건만 골라 주세요. 나머지는 비워 두어도 좋아요.
      </DialogDescription>
      <div className="filter-body">
        <section>
          <h3>한 달, 얼마까지 생각하나요?</h3>
          <div className="budget-grid">
            {(
              [
                ['maxRent', '월세 상한', '40'],
                ['maxMaintenance', '관리비 상한', '5'],
                ['maxDeposit', '보증금 상한', '500'],
              ] as const
            ).map(([key, label, placeholder]) => (
              <label key={key}>
                {label}
                <span className={`input-unit ${errors[key] ? 'invalid' : ''}`}>
                  <input
                    aria-invalid={!!errors[key]}
                    aria-describedby={errors[key] ? `${key}-error` : undefined}
                    inputMode="numeric"
                    value={budget[key]}
                    placeholder={placeholder}
                    onChange={(e) => setBudget({ ...budget, [key]: e.target.value })}
                  />
                  <span>만원</span>
                </span>
                {errors[key] && (
                  <small id={`${key}-error`} className="field-error">
                    {errors[key]}
                  </small>
                )}
              </label>
            ))}
          </div>
          <p className="field-help">빈칸은 제한 없음 · 만원 단위 정수로 입력</p>
        </section>
        <section>
          <h3>생활권</h3>
          <div className="choice-row">
            <button
              aria-pressed={draft.nearCommercial === null}
              className={`choice ${draft.nearCommercial === null ? 'chosen' : ''}`}
              onClick={() => setDraft({ ...draft, nearCommercial: null })}
            >
              상관없어요
            </button>
            <button
              aria-pressed={draft.nearCommercial === true}
              className={`choice ${draft.nearCommercial === true ? 'chosen' : ''}`}
              onClick={() =>
                setDraft({ ...draft, nearCommercial: draft.nearCommercial === true ? null : true })
              }
            >
              학교 주변 상권
            </button>
          </div>
        </section>
        <section>
          <h3>
            가까이 있으면 좋은 시설 <small>도보 경로 500m 이내</small>
          </h3>
          <div className="choice-row">
            {facilityIds.map((id) => (
              <button
                key={id}
                aria-pressed={draft.facilities.includes(id)}
                className={`choice ${draft.facilities.includes(id) ? 'chosen' : ''}`}
                onClick={() =>
                  setDraft({
                    ...draft,
                    facilities: draft.facilities.includes(id)
                      ? draft.facilities.filter((x) => x !== id)
                      : [...draft.facilities, id],
                  })
                }
              >
                {draft.facilities.includes(id) && <Check size={15} />} {facilityLabels[id]}
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3>포기할 수 없는 옵션</h3>
          <div className="choice-row">
            {optionIds.map((id) => (
              <button
                key={id}
                aria-pressed={draft.options.includes(id)}
                className={`choice ${draft.options.includes(id) ? 'chosen' : ''}`}
                onClick={() =>
                  setDraft({
                    ...draft,
                    options: draft.options.includes(id)
                      ? draft.options.filter((x) => x !== id)
                      : [...draft.options, id],
                  })
                }
              >
                {draft.options.includes(id) && <Check size={15} />} {optionLabels[id]}
              </button>
            ))}
          </div>
        </section>
      </div>
      <div className="dialog-actions">
        <button
          className="text-button"
          onClick={() => {
            setDraft(emptyFilters);
            setBudget({ maxRent: '', maxMaintenance: '', maxDeposit: '' });
            setErrors({});
          }}
        >
          <RotateCcw size={15} /> 초기화
        </button>
        <button className="btn primary" onClick={submit}>
          이 조건으로 방 찾기
        </button>
      </div>
    </>
  );
}
