import { NextResponse } from 'next/server'
import { generateInvoicePDF } from '@/lib/pdf/invoice'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const pdfBuffer = await generateInvoicePDF(id)
    // pdfkit returns Buffer; convert for web Response
    const body = new Uint8Array(pdfBuffer)

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="invoice-${id}.pdf"`,
      },
    })
  } catch (error) {
    console.error('PDF generation error:', error)
    return NextResponse.json({ error: 'Failed to generate invoice PDF' }, { status: 500 })
  }
}
