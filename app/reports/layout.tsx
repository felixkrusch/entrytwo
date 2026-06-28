'use client'

import TopBar from '../app/TopBar'

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-screen">
      <TopBar showSettings={true} />
      <div className="flex-1 p-6 overflow-auto bg-zinc-900">
        <div className="max-w-5xl mx-auto">
          {children}
        </div>
      </div>
    </div>
  )
}