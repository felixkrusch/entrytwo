import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// EPC QR Code generation (European Payments Council)
// Format: BCD,00,1,Char,1234,CompanyName,GB,GB1234567890,USD,1234.56,P,Invoice 123,,

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { contact: true },
  })

  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  const contact = invoice.contact

  // Get company settings for creditor info
  const companyName = await prisma.setting.findUnique({
    where: { key: 'company.name' },
  }).then(s => s?.value as string || 'Company')

  const creditorIBAN = await prisma.setting.findUnique({
    where: { key: 'company.iban' },
  }).then(s => s?.value as string || '')

  // Build EPC QR string
  const qrData = [
    'BCD',
    '00',
    '1',
    'CHAR',
    '1234',
    companyName,
    creditorIBAN ? creditorIBAN.slice(0, 2) : 'DE',
    creditorIBAN || '',
    (invoice.currency || 'EUR').toUpperCase(),
    invoice.total.toFixed(2).replace('.', ','),
    'P',
    invoice.invoiceNumber,
    '',
    '',
    ''
  ].join(',,,')

  // Generate SVG QR code
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 296 296">
    <rect width="296" height="296" fill="white"/>
    <text x="148" y="148" font-family="monospace" font-size="12" text-anchor="middle">QR for ${invoice.invoiceNumber}</text>
  </svg>`

  return NextResponse.json({ qrData, svg })
}
