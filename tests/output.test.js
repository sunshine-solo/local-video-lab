'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  makeWorkPath,
  commitOutput,
  discardFile,
} = require('../src/main/ffmpeg/output')

const withTempDir = async (fn) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lvl-output-test-'))
  try {
    return await fn(directory)
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true })
  }
}

test('makeWorkPath keeps the output in the same directory and hides the partial file', () => {
  const workPath = makeWorkPath('/tmp/视频/输出.mp4', 'job-123')
  assert.equal(path.dirname(workPath), '/tmp/视频')
  assert.match(path.basename(workPath), /^\.输出\.partial-job-123\.mp4$/)
})

test('commitOutput replaces an existing target atomically', async () => {
  await withTempDir(async (directory) => {
    const outputPath = path.join(directory, 'result.mp4')
    const workPath = makeWorkPath(outputPath, 'test')
    await fs.promises.writeFile(outputPath, 'old-content')
    await fs.promises.writeFile(workPath, 'new-content')

    await commitOutput(workPath, outputPath)

    assert.equal(await fs.promises.readFile(outputPath, 'utf8'), 'new-content')
    assert.equal(fs.existsSync(workPath), false)
  })
})

test('discardFile ignores missing files', async () => {
  await withTempDir(async (directory) => {
    await discardFile(path.join(directory, 'missing.mp4'))
  })
})
