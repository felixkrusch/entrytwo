import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import QRCode from 'qrcode'
import { requireUser } from '@/lib/authz'

// EPC QR Code (European Payments Council / SEPA Credit Transfer)
// Spec: https://www.europeanpaymentscouncil.eu/document-library/guidance-documents/quick-response-code-guidelines-enable-data-capture-mobile
// Version 2.0

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireUser()) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const { id } = await params
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { contact: true },
  })

  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  // contact used for potential future extension; currently not needed for QR payload
  void invoice.contact

  // Company creditor info from settings (IBAN lives under company.bank in Admin → Company)
  const companyNameSetting = await prisma.setting.findUnique({ where: { key: 'company.name' } })
  const bankSetting = await prisma.setting.findUnique({ where: { key: 'company.bank' } })
  const legacyIbanSetting = await prisma.setting.findUnique({ where: { key: 'company.iban' } })

  const companyName = ((companyNameSetting?.value as Record<string, unknown>)?.value as string) || 'Your Company'
  const bank = (bankSetting?.value && typeof bankSetting.value === 'object' && !Array.isArray(bankSetting.value))
    ? bankSetting.value as Record<string, unknown>
    : {}
  const ibanRaw =
    (typeof bank.iban === 'string' && bank.iban)
    || ((legacyIbanSetting?.value as Record<string, unknown>)?.value as string)
    || ''
  const iban = ibanRaw.replace(/\s+/g, '').toUpperCase()

  const amount = Number(invoice.total).toFixed(2).replace('.', ',')
  const currency = (invoice.currency || 'EUR').toUpperCase()
  const reference = invoice.invoiceNumber

  // EPC QR payload (Version 002, UTF-8, no BIC for many banks)
  // Fields: Service Tag, Version, Encoding, BIC (empty), Name, IBAN, Amount, Currency, Purpose, Reference, Text, ...
  const qrPayload = [
    'BCD',           // Service Tag
    '002',           // Version
    '1',             // Encoding 1 = UTF-8
    '',              // BIC (optional, many SEPA banks accept without)
    companyName.substring(0, 70),
    iban,
    `${currency}${amount}`,
    '',              // Purpose code (optional)
    reference.substring(0, 35),
    '',              // Unstructured remittance info (can put invoice number here too)
    '',              // Information (optional)
  ].join('\n')

  // Generate real SVG QR code
  let svg = ''
  try {
    svg = await QRCode.toString(qrPayload, {
      type: 'svg',
      margin: 1,
      width: 300,
      color: { dark: '#000000', light: '#FFFFFF' },
    })
  } catch {
    // Fallback to a simple placeholder if generation fails
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><rect width="300" height="300" fill="white"/><text x="150" y="150" font-family="monospace" font-size="11" text-anchor="middle">QR ${invoice.invoiceNumber}</text></svg>`
  }

  return NextResponse.json({
    qrData: qrPayload,
    svg,
    iban: iban || null,
    amount: Number(invoice.total),
    currency,
    reference,
    beneficiary: companyName,
  })
}
