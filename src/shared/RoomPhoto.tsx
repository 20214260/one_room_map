'use client';
import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { Room } from '../contracts/schemas';
export function RoomPhoto({
  room,
  className = '',
  priority = false,
}: {
  room: Room;
  className?: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const photo = room.photos[0];
  return !photo || failed ? (
    <div className={`photo-placeholder ${className}`}>
      <ImageOff />
      <span>사진 정보 없음</span>
    </div>
  ) : (
    <img
      className={className}
      src={photo.url}
      alt={photo.alt}
      loading={priority ? 'eager' : 'lazy'}
      onError={() => setFailed(true)}
    />
  );
}
