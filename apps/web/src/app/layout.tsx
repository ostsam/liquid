import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Liquid",
  description: "Just-In-Time interface engine — the AI generates the controls to manipulate the answer.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
