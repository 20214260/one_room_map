-- 프론트 src/services/mock/data.ts 샘플 6개 (금액 원 단위). 여러 번 실행해도 안전
insert into rooms (id, title, neighborhood, deposit, rent, maintenance, area, floor,
  school_distance, near_commercial, description, lat, lng, photos, options, facilities)
values
('sun-01','햇살이 머무는 우드 원룸','석현동 · 정문 생활권',3000000,320000,50000,23.1,2,380,true,
 '밝은 우드톤으로 꾸민 공간이에요. 생활에 필요한 옵션과 월 부담액을 함께 확인해 보세요.',34.9716,127.4801,
 '[{"url":"/images/room-1.jpg","alt":"햇살이 머무는 우드 원룸의 분위기를 보여주는 참고 사진"}]',
 '{"aircon":true,"washer":true,"fridge":true,"induction":true,"desk":true,"closet":true,"elevator":false}',
 '[{"type":"convenience","name":"편의점 (샘플)","distance":100},{"type":"market","name":"마트 (샘플)","distance":320},{"type":"bus","name":"버스정류장 (샘플)","distance":140}]'),
('sun-02','가볍게 시작하는 첫 자취','석현동 · 정문 생활권',2000000,280000,30000,19.8,3,510,true,
 '첫 자취를 시작하는 학생을 위한 작은 공간의 비교 예시예요.',34.9689,127.4807,
 '[{"url":"/images/room-2.jpg","alt":"가볍게 시작하는 첫 자취의 분위기를 보여주는 참고 사진"}]',
 '{"aircon":true,"washer":true,"fridge":true,"induction":true,"desk":false,"closet":false,"elevator":false}',
 '[{"type":"convenience","name":"편의점 (샘플)","distance":140},{"type":"market","name":"마트 (샘플)","distance":410},{"type":"bus","name":"버스정류장 (샘플)","distance":190}]'),
('sun-03','나만의 넉넉한 스튜디오','매곡동 · 후문 생활권',5000000,380000,50000,29.7,4,620,false,
 '공부하는 시간과 쉬는 시간을 나눠 사용할 수 있는 넉넉한 공간의 예시예요.',34.9702,127.4849,
 '[{"url":"/images/room-3.jpg","alt":"나만의 넉넉한 스튜디오의 분위기를 보여주는 참고 사진"}]',
 '{"aircon":true,"washer":true,"fridge":true,"induction":true,"desk":true,"closet":true,"elevator":true}',
 '[{"type":"convenience","name":"편의점 (샘플)","distance":180},{"type":"market","name":"마트 (샘플)","distance":500},{"type":"bus","name":"버스정류장 (샘플)","distance":240}]'),
('sun-04','캠퍼스 옆 미니멀 하우스','석현동 · 정문 생활권',3000000,350000,40000,24.8,2,240,true,
 '밝은 우드톤으로 꾸민 공간이에요. 생활에 필요한 옵션과 월 부담액을 함께 확인해 보세요.',34.9727,127.4808,
 '[{"url":"/images/room-2.jpg","alt":"캠퍼스 옆 미니멀 하우스의 분위기를 보여주는 참고 사진"}]',
 '{"aircon":true,"washer":true,"fridge":true,"induction":true,"desk":false,"closet":true,"elevator":false}',
 '[{"type":"convenience","name":"편의점 (샘플)","distance":220},{"type":"market","name":"마트 (샘플)","distance":590},{"type":"bus","name":"버스정류장 (샘플)","distance":290}]'),
('sun-05','조용한 골목의 작은 방','매곡동 · 후문 생활권',1000000,250000,null,18.2,1,null,false,
 '첫 자취를 시작하는 학생을 위한 작은 공간의 비교 예시예요.',34.9665,127.486,
 '[{"url":"/images/room-3.jpg","alt":"조용한 골목의 작은 방의 분위기를 보여주는 참고 사진"}]',
 '{"aircon":true,"washer":true,"fridge":true,"induction":false,"desk":true,"closet":true,"elevator":null}',
 '[{"type":"convenience","name":"편의점 (샘플)","distance":260},{"type":"market","name":"마트 (샘플)","distance":null},{"type":"bus","name":"버스정류장 (샘플)","distance":340}]'),
('sun-06','책상 앞에서 시작하는 하루','석현동 · 정문 생활권',4000000,340000,40000,26.4,3,710,true,
 '공부하는 시간과 쉬는 시간을 나눠 사용할 수 있는 넉넉한 공간의 예시예요.',34.969,127.4768,
 '[{"url":"/images/room-1.jpg","alt":"책상 앞에서 시작하는 하루의 분위기를 보여주는 참고 사진"}]',
 '{"aircon":true,"washer":true,"fridge":true,"induction":true,"desk":false,"closet":true,"elevator":false}',
 '[{"type":"convenience","name":"편의점 (샘플)","distance":300},{"type":"market","name":"마트 (샘플)","distance":770},{"type":"bus","name":"버스정류장 (샘플)","distance":390}]')
on conflict (id) do nothing;

update rooms set
  source = '{"name":"순룸 UI 시연 데이터","url":null,"collectedAt":"2026-09-22","license":"프로젝트 내부 작성 샘플","kind":"sample","note":"가상의 매물이며 사진은 공간 분위기 참고용입니다. 실제 주소·가격·도보 경로가 아닙니다."}',
  distance_source = '{"name":"순룸 UI 시연 데이터","url":null,"collectedAt":"2026-09-22","license":"프로젝트 내부 작성 샘플","kind":"sample","note":"도보 경로 API 연결 전 시연용 거리입니다."}'
where id like 'sun-%';
