import React, { useState, useEffect } from 'react';
import { AvatarFrame, FrameId } from '@/features/profile/components/atoms/AvatarFrame';
import { cn } from '@/lib/cn';

interface AvatarProps {
  src?: string | null;
  name?: string | null;
  size?: number;
  isOnline?: boolean;
  className?: string;
  style?: React.CSSProperties;
  frameId?: FrameId | string | null;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
}

export const Avatar: React.FC<AvatarProps> = ({
  src, name, size = 32, isOnline, className = '', style: _style = {}, frameId, loading, decoding
}) => {
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
  }, [src]);

  const initials = name
    ? name
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase()
    : '?';

  const sizeStyles: React.CSSProperties = {
    width: size,
    height: size,
    minWidth: size,
    minHeight: size,
  };

  const renderContent = () => {
    if (!src || error || src === 'null' || src === 'undefined') {
      return (
        <div
          className="select-none flex items-center justify-center rounded-full font-bold border border-white/20"
          style={{
            ...sizeStyles,
            fontSize: Math.max(10, size * 0.4),
            background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
            color: '#fff',
          }}
        >
          {initials}
        </div>
      );
    }

    return (
      <img
        src={src}
        alt={name || 'Avatar'}
        className="object-cover rounded-full overflow-hidden"
        style={sizeStyles}
        referrerPolicy="no-referrer"
        onError={() => setError(true)}
        loading={loading}
        decoding={decoding}
      />
    );
  };

  const dotSize = Math.max(8, size * 0.25);
  const dotOffset = Math.max(0, dotSize * 0.15);

  const frameSizeMap: Record<number, 'sm' | 'md' | 'lg' | 'xl'> = {
    32: 'sm',
    40: 'md',
    52: 'md',
    64: 'lg',
    128: 'xl',
    160: 'xl'
  };

  const frameSize = frameSizeMap[size] || (size > 100 ? 'xl' : 'md');

  const content = (
    <div className={cn("relative inline-block rounded-full", className)} style={{ width: size, height: size }}>
      {renderContent()}

      {isOnline && (
        <div
          className="absolute rounded-full border-2 border-white bg-emerald-500 shadow-sm"
          style={{
            width: dotSize,
            height: dotSize,
            right: dotOffset,
            bottom: dotOffset,
            zIndex: 20
          }}
        >
          <div className="absolute inset-0 bg-emerald-500 rounded-full animate-ping opacity-75" />
        </div>
      )}
    </div>
  );

  if (frameId && frameId !== 'none') {
    return (
      <div className={cn("inline-block", className)} style={{ width: size + 8, height: size + 8 }}>
        <AvatarFrame frameId={frameId as FrameId} size={frameSize}>
          {content}
        </AvatarFrame>
      </div>
    );
  }

  return content;
};

