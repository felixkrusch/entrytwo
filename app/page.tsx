import Link from 'next/link'

export default function Landing() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-white p-8">
      <div className="max-w-md text-center">
        <h1 className="text-6xl font-semibold tracking-tighter mb-3">entrytwo</h1>
        <p className="text-xl text-zinc-400 mb-8">AI-native accounting</p>
        
        <Link 
          href="/app"
          className="inline-block bg-white text-black px-8 py-3 rounded-2xl font-medium hover:bg-zinc-200 transition-colors"
        >
          Open Accounting Interface
        </Link>
        
        <div className="mt-8 text-xs text-zinc-600">
          Phase 0/1 • Double-entry core + Chat + Dynamic panels
        </div>
      </div>
    </div>
  )
}
