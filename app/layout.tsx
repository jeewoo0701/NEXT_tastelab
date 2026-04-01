import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], display: 'swap' })

export const metadata: Metadata = {
  title: 'BLIND TEST & WORLD CUP',
  description: 'High-End Minimalist Music Blind Test and World Cup',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={inter.className}>
      <body className="flex flex-col min-h-screen">
        <header className="fixed top-0 w-full h-16 border-b border-pure-white bg-pure-black z-50 flex items-center px-6 uppercase tracking-widest text-sm font-bold">
          <span>NEXT REFINEMENT INSTITUTE</span>
        </header>

        {/* Main layout container with 1px border lines, mimicking high-end grid */}
        <main className="flex-1 mt-16 flex flex-col items-center justify-center p-4">
          <div className="w-full max-w-4xl min-h-[60vh] border border-pure-white flex flex-col relative">
            {/* Corner structural decorative elements removed for an ultra-clean look */}
            {children}
          </div>
        </main>
      </body>
    </html>
  )
}
