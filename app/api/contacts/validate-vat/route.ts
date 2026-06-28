import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function extractCountryCode(vatId: string): string | null {
  const match = vatId.match(/^([A-Z]{2})/)
  return match ? match[1] : null
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const vatId = url.searchParams.get('vatId')
    const countryCode = url.searchParams.get('countryCode')

    if (!vatId) {
      return NextResponse.json({ error: 'vatId parameter required' }, { status: 400 })
    }

    const cc = countryCode || extractCountryCode(vatId)
    
    if (!cc || !['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'GB', 'GR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'].includes(cc.toUpperCase())) {
      return NextResponse.json({ valid: false, reason: 'Unsupported country code' })
    }

    // Call EU VIES service (simplified - in production use proper SOAP client or proxy)
    // Using a lightweight approach with fetch
    const viesUrl = `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${cc.toLowerCase()}/vat/${vatId.slice(2)}`
    
    try {
      const res = await fetch(viesUrl, { method: 'GET' })
      const data = await res.json().catch(() => ({}))
      
      // VIES returns name, address, valid status
      const isValid = data?.responseType === 1 // 1 = valid, 2 = invalid
      
      return NextResponse.json({
        vatId,
        valid: isValid,
        name: data?.name,
        address: data?.address,
      })
    } catch {
      // If VIES fails (network, rate limit), return inconclusive
      return NextResponse.json({
        vatId,
        valid: null,
        error: 'Could not verify VAT ID - please try again later',
      })
    }
  } catch (error) {
    console.error('VAT validation error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const body = await request.json()
  const { contactId, vatValid, vatId, address } = body

  if (!contactId || typeof vatValid !== 'boolean') {
    return NextResponse.json({ error: 'contactId and vatValid required' }, { status: 400 })
  }

  try {
    const updateData: Record<string, unknown> = {
      vatValidated: true,
      vatValid,
      vatValidatedAt: new Date(),
    }

    // Auto-fill contact data from VIES response
    if (vatId) updateData.taxId = vatId
    if (address?.street) updateData.addressStreet = address.street
    if (address?.city) updateData.addressCity = address.city
    if (address?.postalCode) updateData.addressZip = address.postalCode
    if (address?.countryCode) updateData.addressCountry = address.countryCode

    const contact = await prisma.contact.update({
      where: { id: contactId },
      data: updateData,
    })

    return NextResponse.json({ contact, updated: true })
  } catch (error) {
    console.error('Error updating VAT status:', error)
    return NextResponse.json({ error: 'Failed to update VAT status' }, { status: 500 })
  }
}