'use strict'

const { net } = require('electron')
const { isNewerVersion, normalizeVersion } = require('./version')

/*
 * 最低成本的更新检测：用户点击“检查更新”时请求 GitHub Releases API，
 * 只返回版本信息与下载链接，不自动下载、不后台运行。
 * 不依赖代码签名或 electron-updater，因此对当前未签名构建同样可用。
 */

const CACHE_TTL_MS = 60 * 1000
let cache = null

function repositoryFromUrl(repoUrl) {
  const match = /github\.com[/:]([^/]+)\/([^/#?]+)/i.exec(String(repoUrl || ''))
  if (!match) return null
  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/i, ''),
  }
}

function pickDownloadAsset(assets, platform = process.platform, arch = process.arch) {
  const list = Array.isArray(assets) ? assets : []
  const names = list.map((asset) => ({
    name: String(asset.name || ''),
    url: asset.browser_download_url || '',
  }))

  const wanted = (() => {
    if (platform === 'win32') return { include: ['win', 'x64'], extension: '.exe' }
    if (platform === 'darwin') {
      return arch === 'arm64'
        ? { include: ['mac', 'arm64'], extension: '.dmg' }
        : { include: ['mac', 'x64'], extension: '.dmg' }
    }
    return null
  })()
  if (!wanted) return ''

  const match = names.find((item) => (
    item.name.toLowerCase().includes(wanted.extension) &&
    wanted.include.every((token) => item.name.toLowerCase().includes(token))
  ))
  return match?.url || ''
}

/**
 * @returns {Promise<{
 *   ok: boolean,
 *   currentVersion: string,
 *   latestVersion?: string,
 *   hasUpdate?: boolean,
 *   noRelease?: boolean,
 *   releaseUrl?: string,
 *   downloadUrl?: string,
 *   publishedAt?: string,
 *   error?: string,
 * }>}
 */
async function checkForUpdates({ currentVersion, repoUrl, timeoutMs = 15000 } = {}) {
  const repository = repositoryFromUrl(repoUrl)
  if (!repository) return { ok: false, currentVersion, error: '仓库地址无效，无法检查更新' }

  const cacheKey = `${repository.owner}/${repository.repo}@${currentVersion}`
  if (cache && cache.key === cacheKey && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.value
  }

  const apiUrl = `https://api.github.com/repos/${repository.owner}/${repository.repo}/releases/latest`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await net.fetch(apiUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'LocalVideoLab-UpdateChecker',
      },
      signal: controller.signal,
    })

    if (response.status === 404) {
      const value = {
        ok: true,
        currentVersion,
        latestVersion: '',
        hasUpdate: false,
        noRelease: true,
        releaseUrl: `${repoUrl.replace(/\/$/, '')}/releases`,
      }
      cache = { key: cacheKey, at: Date.now(), value }
      return value
    }

    if (response.status === 403) {
      return { ok: false, currentVersion, error: 'GitHub API 请求过于频繁，请稍后再试' }
    }

    if (!response.ok) {
      return { ok: false, currentVersion, error: `检查更新失败（HTTP ${response.status}）` }
    }

    const data = await response.json()
    const latestVersion = normalizeVersion(data.tag_name || '')
    if (!latestVersion) {
      return { ok: false, currentVersion, error: '最新发布中没有可识别的版本号' }
    }

    const value = {
      ok: true,
      currentVersion,
      latestVersion,
      hasUpdate: isNewerVersion(latestVersion, currentVersion),
      releaseUrl: data.html_url || `${repoUrl.replace(/\/$/, '')}/releases`,
      downloadUrl: pickDownloadAsset(data.assets),
      publishedAt: data.published_at || '',
    }
    cache = { key: cacheKey, at: Date.now(), value }
    return value
  } catch (error) {
    const message = error.name === 'AbortError'
      ? '连接 GitHub 超时，请检查网络后重试'
      : '无法连接 GitHub，请检查网络或代理设置'
    return { ok: false, currentVersion, error: message }
  } finally {
    clearTimeout(timer)
  }
}

module.exports = {
  checkForUpdates,
  pickDownloadAsset,
  repositoryFromUrl,
}
