import type { Metadata, Viewport } from "next";
import { Anek_Latin, Anek_Gujarati, Anek_Devanagari } from "next/font/google";
import "./globals.css";

// one Indian type family across Latin, Gujarati and Devanagari so all three languages share a voice
const latin = Anek_Latin({ subsets: ["latin"], variable: "--font-anek-latin", axes: ["wdth"], display: "swap" });
const gu = Anek_Gujarati({ subsets: ["gujarati"], variable: "--font-anek-gu", display: "swap", preload: false });
const hi = Anek_Devanagari({ subsets: ["devanagari"], variable: "--font-anek-hi", display: "swap", preload: false });

export const metadata: Metadata = {
  title: { default: "Company A · Homes in Ahmedabad", template: "%s · Company A" },
  description: "Ask about our homes and book a site visit.",
};

export const viewport: Viewport = { themeColor: "#f3f4f0", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${latin.variable} ${gu.variable} ${hi.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
