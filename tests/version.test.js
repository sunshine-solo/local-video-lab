'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizeVersion,
  parseVersion,
  compareVersions,
  isNewerVersion,
} = require('../src/main/version')

test('normalizeVersion strips a leading v', () => {
  assert.equal(normalizeVersion('v1.2.3'), '1.2.3')
  assert.equal(normalizeVersion(' 1.2.3 '), '1.2.3')
})

test('parseVersion understands core, prerelease and build metadata', () => {
  assert.deepEqual(parseVersion('v1.2.3'), { major: 1, minor: 2, patch: 3, prerelease: [] })
  assert.deepEqual(parseVersion('1.2.3-beta.2'), { major: 1, minor: 2, patch: 3, prerelease: ['beta', '2'] })
  assert.deepEqual(parseVersion('1.2.3+build.5'), { major: 1, minor: 2, patch: 3, prerelease: [] })
  assert.equal(parseVersion('not-a-version'), null)
})

test('compareVersions follows semver ordering', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('v1.0.1', '1.0.0'), 1)
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1)
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1)
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1)
})

test('prerelease versions sort before the final release', () => {
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.1'), 1)
  assert.equal(compareVersions('1.0.0-beta', '1.0.0'), -1)
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.1'), 1)
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-beta'), -1)
})

test('isNewerVersion handles invalid input safely', () => {
  assert.equal(isNewerVersion('1.0.1', '1.0.0'), true)
  assert.equal(isNewerVersion('1.0.0', '1.0.0'), false)
  assert.equal(isNewerVersion('v1.0.0-beta', '1.0.0'), false)
  assert.equal(isNewerVersion('bad', '1.0.0'), false)
})
