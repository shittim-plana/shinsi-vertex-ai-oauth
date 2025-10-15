import type { Metadata } from "next";

export const metadata: Metadata = {
  // Existing
  title: "신시 - AI 채팅 플랫폼",
  description: "AI 채팅 플랫폼",
  keywords: ["신시", "AI", "채팅", "플랫폼", "어시스턴트", "인공지능"], // Use array for keywords
  authors: [{ name: "Mako" }], // Use 'authors' array
  robots: { // Use object for robots
  index: true,
  follow: true,
  googleBot: { // Specific settings for googleBot if needed
  index: true,
  follow: true,
  },
  },
  appleWebApp: { // Use object for Apple web app settings
  capable: true,
  statusBarStyle: "default",
  // title: "신시" // Optional: Title for home screen icon
  },
  // Consider adding Open Graph / Twitter Card metadata here later
};