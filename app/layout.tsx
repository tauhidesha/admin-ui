import './globals.css';
import { ReactNode } from 'react';

export const metadata = {
  title: 'Bosmat Admin Console',
  description: 'Dashboard untuk menangani chat dan booking WhatsApp AI',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
