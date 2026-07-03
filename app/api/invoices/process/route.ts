import { NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

/**
 * Dumb attachment saver.
 * - Accepts one or more files via multipart "file".
 * - Saves them under /public/uploads/receipts.
 * - Returns the list of saved public paths.
 *
 * No text extraction, no heuristics, no suggestions.
 * Text extraction + structuring is done by sending these files
 * as attachments to the LLM in the chat two-pass flow.
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const files = formData.getAll('file') as File[]

    if (!files.length) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const uploadsDir = join(process.cwd(), 'public', 'uploads', 'receipts')
    await mkdir(uploadsDir, { recursive: true })

    const saved: Array<{ name: string; savedPath: string }> = []

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer())
      const safeName = (file.name || 'upload').replace(/[^a-zA-Z0-9_.-]/g, '_')
      const filename = `${Date.now()}-${safeName}`
      const diskPath = join(uploadsDir, filename)
      await writeFile(diskPath, buffer)
      const publicPath = `/uploads/receipts/${filename}`
      saved.push({ name: file.name, savedPath: publicPath })
    }

    return NextResponse.json({ success: true, saved })
  } catch (error) {
    console.error('Attachment save error:', error)
    return NextResponse.json({ error: 'Failed to save attachment(s)' }, { status: 500 })
  }
}
