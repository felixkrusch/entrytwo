import { createServer, type Socket } from 'node:net'
import type { AddressInfo } from 'node:net'
import nodemailer from 'nodemailer'
import { expect, it } from 'vitest'

it('sends authenticated SMTP mail with the patched transport', async () => {
  const messages: string[] = []
  const sockets = new Set<Socket>()
  const server = createServer(socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.write('220 localhost test SMTP\r\n')
    let buffer = ''
    let message: string[] | null = null
    socket.on('data', chunk => {
      buffer += chunk.toString()
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n')
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        if (message) {
          if (line === '.') {
            messages.push(message.join('\n'))
            message = null
            socket.write('250 message accepted\r\n')
          } else message.push(line)
        } else if (line.startsWith('EHLO')) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n')
        else if (line.startsWith('AUTH PLAIN')) socket.write('235 authenticated\r\n')
        else if (line === 'DATA') {
          message = []
          socket.write('354 end with dot\r\n')
        } else if (line === 'QUIT') socket.end('221 bye\r\n')
        else socket.write('250 ok\r\n')
      }
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const transport = nodemailer.createTransport({
      host: '127.0.0.1',
      port: (server.address() as AddressInfo).port,
      secure: false,
      auth: { user: 'test', pass: 'test-only' },
    })
    const result = await transport.sendMail({
      from: 'entrytwo@example.test',
      to: 'admin@example.test',
      subject: 'Sign in to entrytwo',
      text: 'Test magic link: http://localhost:3000/api/auth/callback/email?token=test',
    })
    expect(result.accepted).toContain('admin@example.test')
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('Subject: Sign in to entrytwo')
    expect(messages[0]).toContain('/api/auth/callback/email?token=test')
    transport.close()
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
