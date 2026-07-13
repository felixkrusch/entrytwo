import Image from 'next/image'
import TOTPSetup from '@/app/app/TOTPSetup'

export default function RequiredTotpSetupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-900 p-4 text-white">
      <div className="w-full max-w-xl space-y-4">
        <Image src="/entrytwo-logo.svg" alt="entrytwo" width={128} height={32} className="mx-auto h-8 w-auto" />
        <div className="rounded-lg border border-amber-900/70 bg-amber-950/20 p-3 text-xs text-amber-200">
          Administrators must enable two-factor authentication before accessing financial data or settings.
        </div>
        <TOTPSetup required />
      </div>
    </div>
  )
}
