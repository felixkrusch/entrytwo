import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import sharp from 'sharp'
import { logger } from '../logger'
import { prisma } from '@/lib/prisma'
import { readFile } from 'fs/promises'
import { join } from 'path'

const geistRegularPath = join(process.cwd(), 'node_modules', 'geist', 'dist', 'fonts', 'geist-sans', 'Geist-Regular.ttf')
const geistSemiboldPath = join(process.cwd(), 'node_modules', 'geist', 'dist', 'fonts', 'geist-sans', 'Geist-SemiBold.ttf')

type JsonRecord = Record<string, unknown>

const valueOf = (value: unknown): unknown => value && typeof value === 'object' && 'value' in value ? (value as JsonRecord).value : value
const text = (value: unknown): string => typeof value === 'string' ? value : ''

export async function generateInvoicePDF(invoiceId: string): Promise<Buffer> {
  const [geistRegular, geistSemibold] = await Promise.all([
    readFile(geistRegularPath),
    readFile(geistSemiboldPath),
  ])
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { contact: true, lines: { include: { taxRate: true } } },
  })
  if (!invoice) throw new Error('Invoice not found')

  const settings = await prisma.setting.findMany({ where: { key: { startsWith: 'company.' } } })
  const setting = new Map(settings.map(item => [item.key, valueOf(item.value)]))
  const companyName = text(setting.get('company.name')) || 'Your Company'
  const address = (setting.get('company.address') || {}) as JsonRecord
  const bank = (setting.get('company.bank') || {}) as JsonRecord
  const logoData = text(setting.get('company.logo'))
  const sellerTaxId = text(setting.get('company.taxId'))
  const registrationNumber = text(setting.get('company.registrationNumber'))
  const iban = text(bank.iban)
  const bic = text(bank.bic)
  const bankName = text(bank.bankName)
  const routing = text(bank.routing || bank.transit)
  const accountNumber = text(bank.accountNumber || bank.account)
  const currency = (invoice.currency || 'EUR').toUpperCase()

  const money = new Intl.NumberFormat(invoice.language || 'en', { style: 'currency', currency })
  const date = new Intl.DateTimeFormat(invoice.language || 'en', { year: 'numeric', month: 'short', day: '2-digit' })
  const companyAddress = [
    text(address.street || address.addressStreet),
    text(address.addressLine2 || address.line2),
    [text(address.zip || address.addressZip || address.postal), text(address.city || address.addressCity)].filter(Boolean).join(' '),
    text(address.state || address.addressState),
    text(address.country || address.addressCountry),
  ].filter(Boolean)
  const customerAddress = [
    invoice.contact.addressStreet,
    [invoice.contact.addressZip, invoice.contact.addressCity].filter(Boolean).join(' '),
    invoice.contact.addressState,
    invoice.contact.addressCountry,
  ].filter((item): item is string => Boolean(item))

  let logoUrl: string | null = null
  if (logoData.startsWith('data:')) {
    try {
      const raw = Buffer.from(logoData.split(',')[1] || '', 'base64')
      const png = await sharp(raw).resize(420, 120, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
      logoUrl = `data:image/png;base64,${png.toString('base64')}`
    } catch (error) {
      logger.error('Invoice logo processing failed', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  let qrUrl: string | null = null
  if (iban) {
    try {
      const amount = Number(invoice.total).toFixed(2).replace('.', ',')
      const payload = ['BCD', '002', '1', '', companyName.slice(0, 70), iban.replace(/\s+/g, ''), `${currency}${amount}`, '', invoice.invoiceNumber.slice(0, 35), '', ''].join('\n')
      const qr = await QRCode.toBuffer(payload, { type: 'png', width: 240, margin: 1, errorCorrectionLevel: 'M' })
      qrUrl = `data:image/png;base64,${qr.toString('base64')}`
    } catch (error) {
      logger.error('Invoice payment QR generation failed', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  const doc = new PDFDocument({ size: 'A4', margin: 44, info: { Title: `Invoice ${invoice.invoiceNumber}`, Author: companyName } })
  doc.registerFont('Geist', geistRegular)
  doc.registerFont('Geist-SemiBold', geistSemibold)
  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))

  return new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const left = 44
    const right = 551
    const contentWidth = right - left
    const ink = '#18181b'
    const muted = '#71717a'
    const border = '#e4e4e7'
    const panel = '#f4f4f5'
    const accent = '#2563eb'
    const regular = 'Geist'
    const bold = 'Geist-SemiBold'

    if (logoUrl) doc.image(logoUrl, left, 42, { fit: [132, 42] })
    else doc.font(bold).fontSize(15).fillColor(ink).text(companyName, left, 48, { width: 250 })

    doc.font(bold).fontSize(25).fillColor(ink).text('INVOICE', 350, 40, { width: 201, align: 'right' })
    doc.font(regular).fontSize(9).fillColor(muted).text(invoice.invoiceNumber, 350, 72, { width: 201, align: 'right' })
    doc.roundedRect(468, 89, 83, 20, 10).fill(invoice.status === 'PAID' ? '#dcfce7' : '#dbeafe')
    doc.font(bold).fontSize(8).fillColor(invoice.status === 'PAID' ? '#166534' : '#1d4ed8').text(invoice.status, 468, 96, { width: 83, align: 'center' })

    const german = (invoice.language || 'en').toLowerCase().startsWith('de')
    doc.moveTo(left, 124).lineTo(right, 124).lineWidth(0.7).strokeColor(border).stroke()
    doc.font(bold).fontSize(9.5).fillColor(ink).text(companyName, left, 147, { width: 220 })
    doc.font(regular).fontSize(9.5).fillColor(ink)
    let sellerY = 166
    for (const line of companyAddress) { doc.text(line, left, sellerY, { width: 220 }); sellerY += 14 }
    if (sellerTaxId) { doc.text(`${german ? 'USt-IdNr.' : 'Tax ID'} ${sellerTaxId}`, left, sellerY, { width: 220 }); sellerY += 14 }
    if (registrationNumber) doc.text(`${german ? 'Registernr.' : 'Registration'} ${registrationNumber}`, left, sellerY, { width: 220 })

    doc.font(bold).fontSize(9.5).fillColor(ink).text(german ? 'Rechnungsempfänger' : 'Bill to', 310, 147, { width: 241 })
    doc.font(regular).fontSize(9.5).fillColor(ink)
    let customerY = 166
    doc.text(invoice.contact.name, 310, customerY, { width: 241 }); customerY += 14
    for (const line of customerAddress) { doc.text(line, 310, customerY, { width: 241 }); customerY += 14 }
    if (invoice.contact.email) { doc.text(invoice.contact.email, 310, customerY, { width: 241 }); customerY += 14 }
    if (invoice.contact.taxId) doc.text(`${german ? 'USt-IdNr.' : 'Tax ID'} ${invoice.contact.taxId}`, 310, customerY, { width: 241 })

    const addressBottom = Math.max(sellerY, customerY)
    let y = Math.max(240, addressBottom + 30)
    doc.font(bold).fontSize(15).fillColor(ink).text(
      german
        ? `${money.format(Number(invoice.total))} fällig am ${date.format(invoice.dueDate)}`
        : `${money.format(Number(invoice.total))} due ${date.format(invoice.dueDate)}`,
      left,
      y,
      { width: contentWidth },
    )
    y += 40
    const drawTableHeader = () => {
      doc.font(regular).fontSize(7.5).fillColor(ink)
      doc.text(german ? 'Beschreibung' : 'Description', left, y, { width: 290 })
      doc.text(german ? 'Menge' : 'Quantity', 329, y, { width: 55, align: 'right' })
      doc.text(german ? 'Preis pro Einheit' : 'Unit price', 393, y, { width: 90, align: 'right' })
      doc.text(german ? 'Betrag' : 'Amount', 491, y, { width: 60, align: 'right' })
      y += 15
      doc.moveTo(left, y).lineTo(right, y).lineWidth(0.7).strokeColor(ink).stroke()
      y += 3
    }
    drawTableHeader()

    // Deterministic page breaking for the line items table.
    // We only add a new page when the next row won't fit on the current page.
    const PAGE_BOTTOM = 745

    invoice.lines.forEach((line, index) => {
      const rowHeight = Math.max(34, doc.heightOfString(line.description, { width: 290 }) + 20)
      if (y + rowHeight > PAGE_BOTTOM) {
        doc.addPage()
        y = 50
        drawTableHeader()
      }
      doc.font(regular).fontSize(9.5).fillColor(ink).text(line.description, left, y + 8, { width: 290 })
      doc.text(String(Number(line.quantity)), 329, y + 8, { width: 55, align: 'right' })
      doc.text(money.format(Number(line.unitPrice)), 393, y + 8, { width: 90, align: 'right' })
      doc.text(money.format(Number(line.lineTotal)), 491, y + 8, { width: 60, align: 'right' })
      y += rowHeight
      doc.moveTo(left, y).lineTo(right, y).lineWidth(0.4).strokeColor(border).stroke()
    })

    y += 6
    const totalsX = 291
    const subtotal = Number(invoice.subtotal)
    const taxAmount = Number(invoice.taxAmount)
    const totalRow = (label: string, value: string, bold = false) => {
      doc.moveTo(totalsX, y - 4).lineTo(right, y - 4).lineWidth(0.4).strokeColor(border).stroke()
      doc.font(bold ? 'Geist-SemiBold' : 'Geist').fontSize(9.5).fillColor(ink).text(label, totalsX, y, { width: 155 })
      doc.text(value, 448, y, { width: 103, align: 'right' })
      y += 16
    }
    totalRow(german ? 'Zwischensumme' : 'Subtotal', money.format(subtotal))
    if (taxAmount) totalRow(german ? 'Steuer' : 'Tax', money.format(taxAmount))
    totalRow(german ? 'Summe' : 'Total', money.format(Number(invoice.total)))
    totalRow(german ? 'Fälliger Betrag' : 'Amount due', money.format(Number(invoice.total)), true)

    // After the items table, check if the summary + payment block fits on the current page.
    // If not, start a clean new page for the footer section.
    const summaryHeight = 70 + (iban || routing || accountNumber ? (qrUrl ? 125 : 100) : 0) + (invoice.notes ? 45 : 0)
    if (y + summaryHeight > PAGE_BOTTOM) {
      doc.addPage()
      y = 50
    }

    let paymentY = y + 18
    if (iban || routing || accountNumber) {
      doc.roundedRect(left, paymentY, contentWidth, qrUrl ? 105 : 82, 7).fill(panel)
      if (qrUrl) doc.image(qrUrl, left + 14, paymentY + 14, { width: 76, height: 76 })
      const paymentX = qrUrl ? left + 108 : left + 18
      doc.font(bold).fontSize(9).fillColor(ink).text('PAYMENT DETAILS', paymentX, paymentY + 16)
      doc.font(regular).fontSize(8).fillColor(muted)
      let detailY = paymentY + 34
      const details = [bankName && `Bank  ${bankName}`, iban && `IBAN  ${iban}`, bic && `BIC  ${bic}`, routing && `Routing  ${routing}`, accountNumber && `Account  ${accountNumber}`, `Reference  ${invoice.invoiceNumber}`].filter(Boolean) as string[]
      details.forEach(item => { doc.text(item, paymentX, detailY, { width: right - paymentX - 14 }); detailY += 11 })
      paymentY += qrUrl ? 119 : 96
    }

    if (invoice.notes) {
      doc.font(bold).fontSize(8).fillColor(ink).text('NOTES', left, paymentY)
      doc.font(regular).fontSize(8).fillColor(muted).text(invoice.notes, left, paymentY + 15, { width: contentWidth })
    }

    doc.end()
  })
}
