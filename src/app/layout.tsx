"use client";

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { Providers } from "@/components/Providers";
import { FirebaseAnalytics } from '@/components/FirebaseAnalytics';
import "./globals.css";
import { metadata } from "./metadata";

// Font configuration
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

import { useEffect } from 'react';


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('Service Worker 등록 성공:', registration);
        })
        .catch((error) => {
          console.log('Service Worker 등록 실패:', error);
        });
    }
  }, []);

  return (
    <html lang="ko">
      <head>
        {/* Metadata is now handled by the exported `metadata` object */}
        {/* Manual tags removed */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#007bff" />
        <link rel="apple-touch-icon" href="/icon-512x512.png" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable}`}
        style={{ WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' }}
      >
        <Providers>{children}</Providers>
        <FirebaseAnalytics />
        <Analytics />
      </body>
    </html>
  );
}
