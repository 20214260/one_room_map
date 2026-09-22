# 데이터와 이미지 출처

현재 6개 매물의 이름·가격·좌표·면적·옵션·거리·시설은 UI 검증용으로 직접 만든 가상 데이터입니다. 거래 가능한 실제 매물이나 공공데이터 수집 결과가 아닙니다. 샘플 좌표와 지형은 위치 연동 시연용이며 학교 건물/도로의 정확성을 보증하지 않습니다. `source.kind=sample`, 기준일 2026-09-22를 사용합니다. 정확 주소·연락처는 없습니다.

사진은 각 매물과 무관한 참고 사진이며 화면에 샘플 표시를 제공합니다. 웹사이트에 포함된 형태로 사용하며 사진만 별도로 재판매/스톡 재배포하지 않습니다.

| 파일       | 촬영자 / 출처            | 원본 페이지                                                                        | 라이선스                        |
| ---------- | ------------------------ | ---------------------------------------------------------------------------------- | ------------------------------- |
| room-1.jpg | Max Vakhtbovych / Pexels | https://www.pexels.com/photo/apartment-studio-interior-8142976/                    | https://www.pexels.com/license/ |
| room-2.jpg | Andrea Davis / Unsplash  | https://unsplash.com/photos/a-bedroom-with-white-walls-and-a-white-bed-NOj1YFKJf4Y | https://unsplash.com/license    |
| room-3.jpg | Andrea Davis / Unsplash  | https://unsplash.com/photos/a-bedroom-with-a-bed-desk-and-mirror-uMhgGJYGUTQ       | https://unsplash.com/license    |

이미지 확보일 2026-09-22, 제공 CDN의 1200px 리사이즈 사용, 화면에서는 object-fit:cover. 워터마크 추가나 원본 사실 조작 없음.

실제 매물을 교체할 때에는 확보 방식·사용 허가·URL·라이선스·수집일·가공 내용을 Source에 기록하고 공개 승인 필드를 확인합니다. 무단 크롤링 데이터를 사용하지 않습니다. 관리비와 가격 미상은 null로 유지합니다. 학교/편의시설 도보 거리는 별도 허용 경로 데이터 제공자와 산출 시각을 기록한 distanceSource가 필요합니다.

지도 SDK 공식 참조: https://apis.map.kakao.com/web/documentation/ . API 제공자의 서비스 조건·도메인 등록·키 설정과 별도로 지도 경로 데이터 확보는 팀 작업입니다.

코드 라이선스: 팀의 배포/재사용 정책 미정이므로 현재 `package.json`은 private 프로젝트입니다. 팀이 결정하기 전 임의의 오픈소스 라이선스를 부여하지 않았습니다. 번들에 포함된 라이브러리는 각 라이선스를 따릅니다.
