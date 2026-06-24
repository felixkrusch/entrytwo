import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    // Dynamic import to avoid Turbopack bundling issues with pdf-parse
    const pdfParseMod = await import('pdf-parse')
    const pdfParse = (pdfParseMod as any).default || pdfParseMod
    const data = await pdfParse(buffer)

    // Phase 1 placeholder: return raw text. Real LLM extraction next.
    return NextResponse.json({
      success: true,
      filename: file.name,
      pages: data.numpages,
      text: data.text.substring(0, 3000),
      message: 'PDF parsed. LLM structured extraction coming in Phase 1.'
    })
  } catch (error) {
    console.error('PDF processing error:', error)
    return NextResponse.json(
      { error: 'Failed to process PDF' },
      { status: 500 }
    )
  }
}
