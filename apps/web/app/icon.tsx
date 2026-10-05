import { ImageResponse } from 'next/og';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #10b981, #047857)', borderRadius: 112 }}>
        <div style={{ fontSize: 320, fontWeight: 800, color: 'white', lineHeight: 1 }}>$</div>
      </div>
    ),
    size,
  );
}
