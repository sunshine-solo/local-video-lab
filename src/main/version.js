'use strict'

const normalizeVersion = (value) => String(value || '').trim().replace(/^v/i, '')

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(normalizeVersion(value))
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

function comparePrerelease(a, b) {
  if (!a.length && !b.length) return 0
  if (!a.length) return 1
  if (!b.length) return -1

  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const left = a[index]
    const right = b[index]
    if (left === undefined) return -1
    if (right === undefined) return 1
    if (left === right) continue

    const leftNumeric = /^\d+$/.test(left)
    const rightNumeric = /^\d+$/.test(right)
    if (leftNumeric && rightNumeric) return Number(left) > Number(right) ? 1 : -1
    if (leftNumeric) return -1
    if (rightNumeric) return 1
    return left > right ? 1 : -1
  }
  return 0
}

/** 返回 1 / 0 / -1；无法解析时返回 null。 */
function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return null

  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

function isNewerVersion(candidate, current) {
  return compareVersions(candidate, current) === 1
}

module.exports = {
  normalizeVersion,
  parseVersion,
  compareVersions,
  isNewerVersion,
}
