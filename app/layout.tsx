import type { Metadata } from 'next';
import './globals.css';
import { AppProvider } from '@/src/shared/AppProvider';

export const metadata: Metadata = {
  title: '순룸 | 순천대학교 원룸 비교',
  description: '월 부담액부터 통학 거리까지, 순천대학교 주변 원룸을 나란히 비교하세요.',
  other: {
    'codex-preview': 'development',
  },
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">
        <AppProvider
          config={{
            mode: process.env.NEXT_PUBLIC_DATA_MODE === 'http' ? 'http' : 'mock',
            apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1',
            kakaoMapKey: process.env.NEXT_PUBLIC_KAKAO_MAP_KEY || '',
          }}
        >
          {children}
        </AppProvider>
      </body>
    </html>
  );
}
