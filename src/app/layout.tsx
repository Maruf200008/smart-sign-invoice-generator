import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ToastViewport } from "@/components/ui/ToastViewport";
import { buildInvoiceFontCss, PRIMARY_FONT_FILES } from "@/lib/fonts/font-registry";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

// Self-hosted @font-face rules for the invoice's Bengali/Latin font chain (see font-registry.ts).
const invoiceFontCss = buildInvoiceFontCss();

export const metadata: Metadata = {
  title: "Smart Sign Invoice",
  description:
    "A4 invoice generator with live editing, one-click PDF download and full Bangla support.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/fav_icon.svg",
    shortcut: "/fav_icon.svg",
    apple: "/fav_icon.svg"
  },
  appleWebApp: {
    capable: true,
    title: "Smart Sign",
    statusBarStyle: "default"
  }
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* The primary invoice font is needed for the first paint of every invoice; fetch it with the HTML. */}
        {PRIMARY_FONT_FILES.map((file) => (
          <link key={file.url} rel="preload" href={file.url} as="font" type="font/ttf" crossOrigin="anonymous" />
        ))}
        <style dangerouslySetInnerHTML={{ __html: invoiceFontCss }} />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        {children}
        <ToastViewport />
      </body>
    </html>
  );
}
