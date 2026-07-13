import { NextResponse } from 'next/server'
import { generateInvoicePDF } from '@/lib/pdf/invoice'
import { requireUser } from '@/lib/authz'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireUser()) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
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
    logger.error('PDF generation error', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to generate invoice PDF' }, { status: 500 })
  }
}
