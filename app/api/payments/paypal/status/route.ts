import { NextResponse } from 'next/server'

export async function GET() {
  const configured = !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET)
  return NextResponse.json({ configured })
}
