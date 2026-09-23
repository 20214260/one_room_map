// Transport-neutral events; no email, free-text prompt, token or password.
export type AnalyticsName =
  | 'room_detail_view'
  | 'comparison_open'
  | 'comparison_complete'
  | 'recommendation_ai'
  | 'recommendation_rules'
  | 'login_success'
  | 'room_submitted';
export function track(name: AnalyticsName, roomIds: string[] = []) {
  if (typeof window !== 'undefined')
    window.dispatchEvent(
      new CustomEvent('sunroom:analytics', {
        detail: { name, roomIds, occurredAt: new Date().toISOString() },
      }),
    );
}
