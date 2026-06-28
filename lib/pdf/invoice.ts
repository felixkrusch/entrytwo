import { prisma } from '@/lib/prisma'

export async function generateInvoicePDF(invoiceId: string): Promise<string> {
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

  const formatDate = (date: Date) => date.toISOString().split('T')[0]
  const formatCurrency = (amount: number) => `${invoice.currency} ${(amount / 100).toFixed(2)}`

  // Placeholder HTML - would use @react-pdf/renderer or similar
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Invoice ${invoice.invoiceNumber}</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 40px; }
    .header { border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
    .invoice-details { float: right; text-align: right; }
    .totals { margin-top: 30px; text-align: right; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
    .total-row { font-weight: bold; font-size: 1.2em; }
  </style>
</head>
<body>
  <div class="header">
    <h1>INVOICE ${invoice.invoiceNumber}</h1>
    <div class="invoice-details">
      <p>Issue Date: ${formatDate(invoice.issueDate)}</p>
      <p>Due Date: ${formatDate(invoice.dueDate)}</p>
      <p>Status: ${invoice.status}</p>
    </div>
  </div>
  
  <div>
    <h3>Bill To:</h3>
    <p>${invoice.contact.name}</p>
    ${invoice.contact.addressStreet ? `<p>${invoice.contact.addressStreet}</p>` : ''}
    ${invoice.contact.addressCity ? `<p>${invoice.contact.addressCity} ${invoice.contact.addressZip || ''}</p>` : ''}
    ${invoice.contact.addressCountry ? `<p>${invoice.contact.addressCountry}</p>` : ''}
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th>Qty</th>
        <th>Price</th>
        <th>Amount</th>
      </tr>
    </thead>
    <tbody>
      ${invoice.lines.map(line => `
        <tr>
          <td>${line.description}</td>
          <td>${line.quantity}</td>
          <td>${formatCurrency(Number(line.unitPrice))}</td>
          <td>${formatCurrency(Number(line.lineTotal))}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="totals">
    <p>Total: ${formatCurrency(Number(invoice.total))}</p>
  </div>

  ${invoice.notes ? `<p><strong>Notes:</strong> ${invoice.notes}</p>` : ''}
  ${invoice.terms ? `<p><strong>Terms:</strong> ${invoice.terms}</p>` : ''}
</body>
</html>
  `

  return html
}
