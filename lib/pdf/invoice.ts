import PDFDocument from 'pdfkit/js/pdfkit.standalone'
import { prisma } from '@/lib/prisma'
import QRCode from 'qrcode'
import fs from 'fs'
import path from 'path'

export async function generateInvoicePDF(invoiceId: string): Promise<Buffer> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      contact: true,
      lines: { include: { taxRate: true } },
    },
  })

  if (!invoice) {
    throw new Error('Invoice not found')
  }

  // Company settings
  const [nameS, addrS, bankS, logoS, taxIdS, regS] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'company.name' } }),
    prisma.setting.findUnique({ where: { key: 'company.address' } }),
    prisma.setting.findUnique({ where: { key: 'company.bank' } }),
    prisma.setting.findUnique({ where: { key: 'company.logo' } }),
    prisma.setting.findUnique({ where: { key: 'company.taxId' } }),
    prisma.setting.findUnique({ where: { key: 'company.registrationNumber' } }),
  ])

  const companyName = ((nameS?.value as Record<string, unknown>)?.value as string) || 'Your Company'
  const addr = (addrS?.value as Record<string, unknown>) || {}
  const bank = (bankS?.value as Record<string, unknown>) || {}
  const iban = ((bank as Record<string, unknown>).iban as string) || ''
  const bic = ((bank as Record<string, unknown>).bic as string) || ''
  const bankName = ((bank as Record<string, unknown>).bankName as string) || ''
  const routing = ((bank as Record<string, unknown>).routing as string) || ((bank as Record<string, unknown>).transit as string) || ''
  const accountNumber = ((bank as Record<string, unknown>).accountNumber as string) || ((bank as Record<string, unknown>).account as string) || ''
  const logoData = (logoS?.value as Record<string, unknown>)?.value as string | undefined
  const sellerTaxId = ((taxIdS?.value as Record<string, unknown>)?.value as string) || ''
  const regNumber = ((regS?.value as Record<string, unknown>)?.value as string) || ''

  const addressLines: string[] = [
    (addr.street || addr.addressStreet) as string | undefined,
    (addr.addressLine2 || (addr as Record<string, unknown>).line2) as string | undefined,
    [addr.city || addr.addressCity, addr.state || addr.addressState].filter(Boolean).join(', '),
    [addr.zip || addr.addressZip, (addr as Record<string, unknown>).postal].filter(Boolean).join(' '),
    addr.country || addr.addressCountry,
  ].filter((x): x is string => Boolean(x))

  // Generate EPC QR for bank transfer (if IBAN present)
  let qrBuffer: Buffer | null = null
  if (iban) {
    const amount = Number(invoice.total).toFixed(2).replace('.', ',')
    const cur = (invoice.currency || 'EUR').toUpperCase()
    const ref = invoice.invoiceNumber

    const payload = [
      'BCD',
      '002',
      '1',
      '',
      companyName.substring(0, 70),
      iban.replace(/\s+/g, ''),
      `${cur}${amount}`,
      '',
      ref.substring(0, 35),
      '',
      '',
    ].join('\n')

    try {
      qrBuffer = await QRCode.toBuffer(payload, { type: 'png', width: 180, margin: 1 })
    } catch {}
  }

  const chunks: Buffer[] = []
  const doc = new PDFDocument({ size: 'A4', margin: 40 })
  doc.on('data', (c: Buffer) => chunks.push(c))

  // Load local Geist TTFs (fallback to built-in if missing) - store Geist*.ttf in public/fonts/
  const geistRegPath = path.join(process.cwd(), 'public/fonts/Geist-Regular.ttf')
  const geistBoldPath = path.join(process.cwd(), 'public/fonts/Geist-Bold.ttf')
  let hasGeist = false
  try {
    if (fs.existsSync(geistRegPath)) {
      doc.registerFont('Geist', geistRegPath)
      hasGeist = true
    }
    if (fs.existsSync(geistBoldPath)) {
      doc.registerFont('GeistBold', geistBoldPath)
    }
  } catch {}

  // Use Geist if available, else default Helvetica (pdfkit built-in)
  const fontReg = hasGeist ? 'Geist' : 'Helvetica'
  const fontBold = hasGeist && fs.existsSync(geistBoldPath) ? 'GeistBold' : 'Helvetica-Bold'
  doc.font(fontReg)

  return await new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // Use registered fonts (Geist if present)
    const use = (name: string) => { try { doc.font(name) } catch {} }

    // === HEADER (logo left, seller right) - matches example style ===
    if (logoData && logoData.startsWith('data:image')) {
      try {
        const logoBuf = Buffer.from(logoData.split(',')[1], 'base64')
        doc.image(logoBuf, 40, 30, { width: 110, height: 36, fit: [110, 36] })
      } catch {}
    }

    use(fontBold)
    doc.fontSize(16).text(companyName, 180, 28)
    use(fontReg)
    doc.fontSize(9)
    const sellerLines: string[] = []
    addressLines.forEach(l => sellerLines.push(l))
    if (sellerTaxId) sellerLines.push(`VAT/Tax ID: ${sellerTaxId}`)
    if (regNumber) sellerLines.push(`Reg: ${regNumber}`)
    if (iban) sellerLines.push(`IBAN: ${iban}${bic ? `  BIC: ${bic}` : ''}`)
    else if (routing || accountNumber) {
      if (bankName) sellerLines.push(bankName)
      if (routing) sellerLines.push(`Routing: ${routing}`)
      if (accountNumber) sellerLines.push(`Account: ${accountNumber}`)
    }
    sellerLines.slice(0, 6).forEach((l, i) => {
      doc.text(l, 180, 46 + i * 11)
    })

    // === META (right aligned) ===
    doc.fontSize(10)
    doc.text('INVOICE', 450, 28, { align: 'right' })
    doc.fontSize(9)
    doc.text(invoice.invoiceNumber, 450, 42, { align: 'right' })
    doc.text(`Issue: ${invoice.issueDate.toISOString().slice(0, 10)}`, 450, 55, { align: 'right' })
    doc.text(`Due: ${invoice.dueDate.toISOString().slice(0, 10)}`, 450, 67, { align: 'right' })
    doc.text(invoice.status, 450, 79, { align: 'right' })

    // === BILL TO (left) ===
    let y = 140
    use(fontBold)
    doc.fontSize(9).text('Bill To', 40, y)
    use(fontReg)
    doc.fontSize(11).text(invoice.contact.name || '', 40, y + 14)
    const cAddr = [
      invoice.contact.addressStreet,
      [invoice.contact.addressZip, invoice.contact.addressCity].filter(Boolean).join(' '),
      invoice.contact.addressState,
      invoice.contact.addressCountry,
    ].filter((x): x is string => Boolean(x))
    cAddr.forEach((l, i) => doc.fontSize(9).text(l, 40, y + 28 + i * 12))
    const contactEmail = (invoice.contact as unknown as Record<string, unknown>).email as string | undefined
    if (contactEmail) doc.fontSize(8).text(contactEmail, 40, y + 28 + cAddr.length * 12 + 4)
    if (invoice.contact.taxId) doc.fontSize(8).text(`VAT: ${invoice.contact.taxId}`, 40, y + 28 + cAddr.length * 12 + 16)

    // === LINES ===
    y = Math.max(y + 110, 240)
    use(fontReg)
    doc.fontSize(9)
    doc.text('Description', 40, y)
    doc.text('Qty', 340, y)
    doc.text('Unit', 400, y)
    doc.text('Tax', 460, y)
    doc.text('Amount', 520, y)
    y += 14
    doc.moveTo(40, y).lineTo(555, y).stroke()
    y += 8

    for (const line of invoice.lines) {
      const taxPct = line.taxRate ? `${(Number(line.taxRate.rate) * 100).toFixed(0)}%` : ''
      doc.text((line.description || '').substring(0, 52), 40, y)
      doc.text(String(Number(line.quantity) || 0), 340, y)
      doc.text(Number(line.unitPrice).toFixed(2), 400, y)
      doc.text(taxPct, 460, y)
      doc.text(Number(line.lineTotal).toFixed(2), 520, y)
      y += 14
      if (y > 620) break
    }

    // === TOTALS (right column, tight) ===
    y += 12
    const inv = invoice as unknown as Record<string, unknown>
    const sub = Number(inv.subtotal ?? (Number(inv.total) || 0) - (Number(inv.taxAmount) || 0)) || 0
    doc.text('Subtotal', 420, y)
    doc.text(sub.toFixed(2), 520, y)
    y += 14
    const taxAmt = Number(inv.taxAmount) || 0
    if (taxAmt > 0) {
      doc.text('Tax', 420, y)
      doc.text(taxAmt.toFixed(2), 520, y)
      y += 14
    }
    use(fontBold)
    doc.fontSize(11).text('Total', 420, y)
    doc.text(`${invoice.currency} ${Number(inv.total || 0).toFixed(2)}`, 520, y)
    use(fontReg)

    // === PAYMENT / BANK (clean block, below totals) ===
    y += 28
    if (qrBuffer && iban) {
      doc.image(qrBuffer, 40, y, { width: 72, height: 72 })
      doc.fontSize(8).text('Scan to pay (SEPA/EPC)', 120, y + 4)
      doc.text(`Ref: ${invoice.invoiceNumber}`, 120, y + 16)
      doc.text(`IBAN ${iban}${bic ? '  BIC ' + bic : ''}`, 120, y + 28)
      y += 88
    } else if (iban || routing || accountNumber) {
      doc.fontSize(8).text('Pay by bank transfer', 40, y)
      y += 12
      if (iban) { doc.text(`IBAN: ${iban}${bic ? '  BIC: ' + bic : ''}`, 40, y); y += 11 }
      if (bankName) { doc.text(`Bank: ${bankName}`, 40, y); y += 11 }
      if (routing) { doc.text(`Routing/Transit: ${routing}`, 40, y); y += 11 }
      if (accountNumber) { doc.text(`Account: ${accountNumber}`, 40, y); y += 11 }
      y += 6
    }

    // === NOTES (free text) ===
    const invNotes = (invoice as unknown as Record<string, unknown>).notes as string | undefined
    if (invNotes) {
      y += 4
      doc.fontSize(9).text('Notes', 40, y)
      y += 12
      doc.fontSize(8).text(String(invNotes), 40, y, { width: 515 })
      y += 24
    }

    // === FOOTER (small) ===
    y = Math.max(y + 10, 700)
    doc.fontSize(7).text('Thank you.', 40, y)

    doc.end()
  })
}
