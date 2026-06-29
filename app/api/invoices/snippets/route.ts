import { NextResponse } from 'next/server'

const defaultSnippets = [
  { id: '1', name: 'Consulting', description: 'Professional consulting services', quantity: 1, unitPrice: 150 },
  { id: '2', name: 'Web Dev', description: 'Website development', quantity: 20, unitPrice: 100 },
  { id: '3', name: 'Design', description: 'Graphic design work', quantity: 10, unitPrice: 75 },
  { id: '4', name: 'Hosting', description: 'Monthly hosting service', quantity: 1, unitPrice: 29 },
  { id: '5', name: 'Support', description: 'Technical support (1hr)', quantity: 1, unitPrice: 85 },
]

export async function GET() {
  return NextResponse.json({ snippets: defaultSnippets })
}