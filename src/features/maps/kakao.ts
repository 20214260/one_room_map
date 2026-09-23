import type { Bounds, Room, Filters } from '../../contracts/schemas';
import { matches, money } from '../../domain/rooms';
// Small vendor boundary. No Kakao globals leak into screens or domain types.
type LatLng = { getLat(): number; getLng(): number };
type MapInstance = {
  getBounds(): { getSouthWest(): LatLng; getNorthEast(): LatLng };
  setCenter(p: LatLng): void;
  getLevel(): number;
  setLevel(l: number): void;
  relayout(): void;
};
type Overlay = { setMap(map: MapInstance | null): void };
type KakaoMaps = {
  load(cb: () => void): void;
  LatLng: new (lat: number, lng: number) => LatLng;
  Map: new (el: HTMLElement, options: object) => MapInstance;
  Marker: new (options: object) => {
    setPosition(p: LatLng): void;
    setMap(map: MapInstance | null): void;
  };
  CustomOverlay: new (options: object) => Overlay;
  event: {
    addListener(target: MapInstance, event: string, cb: (event: { latLng: LatLng }) => void): void;
    removeListener(
      target: MapInstance,
      event: string,
      cb: (event: { latLng: LatLng }) => void,
    ): void;
  };
};
declare global {
  interface Window {
    kakao?: { maps: KakaoMaps };
  }
}
let loading: Promise<KakaoMaps> | null = null;
export function loadKakao(key: string): Promise<KakaoMaps> {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    let script: HTMLScriptElement | undefined;
    const timeout = setTimeout(() => fail(), 10000);
    function fail() {
      clearTimeout(timeout);
      script?.remove();
      loading = null;
      reject(new Error('지도를 불러오지 못했어요. 목록에서 계속 방을 찾을 수 있어요.'));
    }
    function ready() {
      if (!window.kakao?.maps) return fail();
      window.kakao.maps.load(() => {
        clearTimeout(timeout);
        resolve(window.kakao!.maps);
      });
    }
    if (window.kakao?.maps) return ready();
    script = document.createElement('script');
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
    script.async = true;
    script.onload = ready;
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return loading;
}
export async function createKakaoView(
  el: HTMLElement,
  key: string,
  onBounds: (b: Bounds) => void,
  onSelect: (id: string) => void,
) {
  const sdk = await loadKakao(key);
  const center = new sdk.LatLng(34.9709, 127.4806);
  const map = new sdk.Map(el, { center, level: 4 });
  let overlays: Overlay[] = [];
  const idle = () => {
    const b = map.getBounds(),
      sw = b.getSouthWest(),
      ne = b.getNorthEast();
    onBounds({ south: sw.getLat(), west: sw.getLng(), north: ne.getLat(), east: ne.getLng() });
  };
  sdk.event.addListener(map, 'idle', idle);
  const resize = new ResizeObserver(() => map.relayout());
  resize.observe(el);
  idle();
  return {
    render(rooms: Room[], filters: Filters) {
      overlays.forEach((o) => o.setMap(null));
      overlays = [];
      const groups = new Map<string, Room[]>();
      rooms
        .filter((r) => r.coordinates)
        .forEach((r) => {
          const key = `${r.coordinates!.lat.toFixed(3)},${r.coordinates!.lng.toFixed(3)}`;
          groups.set(key, [...(groups.get(key) ?? []), r]);
        });
      groups.forEach((group) => {
        const r = group[0];
        const button = document.createElement('button');
        button.className = `map-marker ${group.some((r) => matches(r, filters)) ? 'matching' : 'muted-marker'}`;
        button.textContent = group.length === 1 ? `월 ${money(r.rent)}` : `${group.length}개 방`;
        button.setAttribute(
          'aria-label',
          group.length === 1 ? `${r.title} 상세 보기` : `이 구역 ${group.length}개 방 보기`,
        );
        button.onclick = () => {
          if (group.length === 1) onSelect(r.id);
          else {
            const lats = group.map((r) => r.coordinates!.lat),
              lngs = group.map((r) => r.coordinates!.lng);
            onBounds({
              south: Math.min(...lats) - 0.0005,
              north: Math.max(...lats) + 0.0005,
              west: Math.min(...lngs) - 0.0005,
              east: Math.max(...lngs) + 0.0005,
            });
          }
        };
        overlays.push(
          new sdk.CustomOverlay({
            map,
            position: new sdk.LatLng(r.coordinates!.lat, r.coordinates!.lng),
            content: button,
            yAnchor: 1,
            clickable: true,
          }),
        );
      });
    },
    reset() {
      map.setCenter(center);
      map.setLevel(4);
      idle();
    },
    zoom(delta: number) {
      map.setLevel(Math.max(1, Math.min(10, map.getLevel() + delta)));
    },
    destroy() {
      resize.disconnect();
      sdk.event.removeListener(map, 'idle', idle);
      overlays.forEach((o) => o.setMap(null));
      el.replaceChildren();
    },
  };
}
export type KakaoView = Awaited<ReturnType<typeof createKakaoView>>;

export async function createLocationPicker(
  el: HTMLElement,
  key: string,
  initial: Room['coordinates'],
  onPick: (point: NonNullable<Room['coordinates']>) => void,
) {
  const sdk = await loadKakao(key);
  const toPoint = (p: NonNullable<Room['coordinates']>) => new sdk.LatLng(p.lat, p.lng);
  const map = new sdk.Map(el, {
    center: toPoint(initial ?? { lat: 34.9709, lng: 127.4806 }),
    level: 4,
  });
  const marker = new sdk.Marker({ position: toPoint(initial ?? { lat: 34.9709, lng: 127.4806 }) });
  if (initial) marker.setMap(map);
  const pick = (event: { latLng: LatLng }) => {
    marker.setMap(map);
    marker.setPosition(event.latLng);
    onPick({ lat: event.latLng.getLat(), lng: event.latLng.getLng() });
  };
  sdk.event.addListener(map, 'click', pick);
  const resize = new ResizeObserver(() => map.relayout());
  resize.observe(el);
  return {
    set(point: Room['coordinates']) {
      marker.setMap(point ? map : null);
      if (point) {
        marker.setPosition(toPoint(point));
        map.setCenter(toPoint(point));
      }
    },
    destroy() {
      resize.disconnect();
      sdk.event.removeListener(map, 'click', pick);
      marker.setMap(null);
      el.replaceChildren();
    },
  };
}
