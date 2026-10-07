/**
 * Screen orientation that also works where `screen.orientation` does not
 * exist: Safari before 16.4, which is inside the SDK's iOS 15 support floor.
 * Reaching for `screen.orientation.type` there threw, and the scan never got
 * past its intro. The legacy `window.orientation` angle and its
 * `orientationchange` event stand in for it.
 */
export interface ScreenOrientationReading {
  /** 'portrait-primary' | 'portrait-secondary' | 'landscape-primary' | 'landscape-secondary' */
  type: string;
  /** Degrees: 0, 90, 180 or 270. */
  angle: number;
}

export function readScreenOrientation(): ScreenOrientationReading {
  const current = typeof screen !== 'undefined' ? (screen as any).orientation : undefined;
  if (current && typeof current.type === 'string') {
    return { type: current.type, angle: current.angle ?? 0 };
  }

  // window.orientation runs (-90, 180]; -90 is screen.orientation's 270.
  const legacy = typeof window !== 'undefined' ? (window as any).orientation : undefined;
  if (typeof legacy === 'number') {
    const angle = (legacy + 360) % 360;
    const type =
      angle === 90 ? 'landscape-primary'
      : angle === 270 ? 'landscape-secondary'
      : angle === 180 ? 'portrait-secondary'
      : 'portrait-primary';
    return { type, angle };
  }

  // Neither API: not a phone (iOS has window.orientation, Android
  // screen.orientation) but a desktop, whose landscape is its natural
  // orientation -- angle 0, as screen.orientation reports it there. 90 read
  // as a phone held sideways and turned the portrait-only screens.
  const landscape = typeof window !== 'undefined' && !!window.matchMedia?.('(orientation: landscape)').matches;
  return landscape ? { type: 'landscape-primary', angle: 0 } : { type: 'portrait-primary', angle: 0 };
}

/** Calls `listener` on every orientation change; returns the unsubscribe. */
export function onScreenOrientationChange(listener: () => void): () => void {
  const current = typeof screen !== 'undefined' ? (screen as any).orientation : undefined;
  if (current && typeof current.addEventListener === 'function') {
    current.addEventListener('change', listener);
    return () => current.removeEventListener('change', listener);
  }

  window.addEventListener('orientationchange', listener);
  return () => window.removeEventListener('orientationchange', listener);
}
