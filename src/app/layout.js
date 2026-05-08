import "./globals.css";

export const metadata = {
  title: "Queue System",
  description: "Firebase priority queue system",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
