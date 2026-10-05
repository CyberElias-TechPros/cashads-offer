import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #10b981, #047857)' }}>
        <div style={{ fontSize: 116, fontWeight: 800, color: 'white', lineHeight: 1 }}>$</div>
      </div>
    ),
    size,
  );
}
