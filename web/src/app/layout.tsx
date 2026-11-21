import type { Metadata, Viewport } from "next";
import { Noto_Sans_Bengali, Noto_Sans_Devanagari, Roboto, Roboto_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const roboto = Roboto({ variable: "--font-roboto", subsets: ["latin"], weight: ["400", "500", "700"] });
const robotoMono = Roboto_Mono({ variable: "--font-roboto-mono", subsets: ["latin"], weight: ["400", "500"] });
const bengali = Noto_Sans_Bengali({ variable: "--font-bengali", subsets: ["bengali"], weight: ["400", "500"] });
const devanagari = Noto_Sans_Devanagari({ variable: "--font-devanagari", subsets: ["devanagari"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "Vinayak Procurement · HOD", template: "%s · Vinayak Procurement" },
  description: "Contracts & Planning HOD dashboard for Vinayak Group procurement.",
};

export const viewport: Viewport = {
  themeColor: "#ce181e",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${roboto.variable} ${robotoMono.variable} ${bengali.variable} ${devanagari.variable} h-full`}
    >
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
