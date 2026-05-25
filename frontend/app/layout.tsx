import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import Script from 'next/script';
import './globals.css';

const sans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Unity — Clinical Ops Dashboard',
  description: 'Internal operations monitoring dashboard for the Unity clinical system',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body>
        <Script
          src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"
          strategy="beforeInteractive"
        />
        {/* Set global Chart.js font to match the app font */}
        <Script id="chartjs-font" strategy="afterInteractive">{`
          if (typeof window !== 'undefined' && window.Chart) {
            window.Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";
            window.Chart.defaults.font.size = 12;
          }
        `}</Script>
        {children}
      </body>
    </html>
  );
}
