import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const script = readFileSync(new URL('./check-node.mjs', import.meta.url), 'utf8')

test('supported Node versions pass', () => {
  for (const version of ['22.12.0', '22.23.4', '24.0.0']) {
    runInNewContext(script, { process: { versions: { node: version } } })
  }
})

test('unsupported Node versions fail with installation guidance', () => {
  for (const version of ['20.19.0', '22.11.0', '23.0.0', '25.0.0']) {
    let message = ''
    assert.throws(() => runInNewContext(script, {
      process: {
        versions: { node: version },
        exit(code) { throw new Error(`exit ${code}`) },
      },
      console: { error(value) { message = value } },
    }), /exit 1/)
    assert.ok(message.includes(version))
    assert.ok(message.includes('nodejs.org'))
  }
})
