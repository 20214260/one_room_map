// vinext 1.0.0-beta.5 배포 빌드 우회 (개발 서버에는 영향 없음).
// pnpm 설치 경로에서는 next/navigation shim 이 진입 청크에 합쳐지고, <Link>·router.push 가
// 동적 import 로 꺼내 쓰는 navigateClientSide 가 tree-shaking 으로 빠져 페이지 이동이 멈춤.
// 네임스페이스를 한 번 참조해 모든 export 를 보존한다. vinext 를 올려 고쳐지면 삭제.
import * as navigation from 'next/navigation';

(globalThis as Record<string, unknown>).__sunroomNavigation = navigation;
