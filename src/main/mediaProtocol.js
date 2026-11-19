'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { Readable } = require('node:stream')
const { protocol } = require('electron')

/*
 * 自定义 media:// 协议：渲染进程用 <video> 预览本地任意路径的视频。
 * - 必须支持 Range（206），否则拖动进度条会失效。
 * - 必须带 CORS 头，画布预览（去水印框选）才能读取视频帧而不污染 canvas。
 * - 只放行常见音视频扩展名，避免这个协议被当成任意文件读取接口。
 */

const SCHEME = 'media'

const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.ts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.3gp': 'video/3gpp',
  '.ogv': 'video/ogg',
  '.ogg': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
}

function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([{
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  }])
}

function registerMediaProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    try {
      const url = new URL(request.url)
      const filePath = decodeURIComponent(url.pathname.replace(/^\//, ''))
      if (!filePath || !path.isAbsolute(filePath)) {
        return new Response('Bad Request', { status: 400, headers: corsHeaders })
      }

      const extension = path.extname(filePath).toLowerCase()
      const mime = MIME_TYPES[extension]
      if (!mime) {
        return new Response('Forbidden', { status: 403, headers: corsHeaders })
      }

      const stat = await fs.promises.stat(filePath)
      if (!stat.isFile()) {
        return new Response('Not Found', { status: 404, headers: corsHeaders })
      }

      const total = stat.size
      const baseHeaders = {
        ...corsHeaders,
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      }

      const rangeHeader = request.headers.get('range')
      const isHead = request.method === 'HEAD'

      if (!rangeHeader) {
        const headers = { ...baseHeaders, 'Content-Length': String(total) }
        if (isHead) return new Response(null, { status: 200, headers })
        const stream = Readable.toWeb(fs.createReadStream(filePath))
        return new Response(stream, { status: 200, headers })
      }

      const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim())
      if (!match || (match[1] === '' && match[2] === '')) {
        return new Response('Range Not Satisfiable', {
          status: 416,
          headers: { ...baseHeaders, 'Content-Range': `bytes */${total}` },
        })
      }

      let start
      let end
      if (match[1] === '') {
        const suffixLength = Number(match[2])
        if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
          return new Response('Range Not Satisfiable', {
            status: 416,
            headers: { ...baseHeaders, 'Content-Range': `bytes */${total}` },
          })
        }
        start = Math.max(0, total - suffixLength)
        end = total - 1
      } else {
        start = Number(match[1])
        end = match[2] === '' ? total - 1 : Math.min(Number(match[2]), total - 1)
      }

      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
        return new Response('Range Not Satisfiable', {
          status: 416,
          headers: { ...baseHeaders, 'Content-Range': `bytes */${total}` },
        })
      }

      const headers = {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': String(end - start + 1),
      }
      if (isHead) return new Response(null, { status: 206, headers })
      const stream = Readable.toWeb(fs.createReadStream(filePath, { start, end }))
      return new Response(stream, { status: 206, headers })
    } catch (error) {
      if (error.code === 'ENOENT') {
        return new Response('Not Found', {
          status: 404,
          headers: { 'Access-Control-Allow-Origin': '*' },
        })
      }
      console.warn('media protocol error:', error)
      return new Response('Internal Error', {
        status: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
      })
    }
  })
}

function toMediaUrl(filePath) {
  return `${SCHEME}://local/${encodeURIComponent(String(filePath))}`
}

module.exports = {
  SCHEME,
  registerMediaScheme,
  registerMediaProtocol,
  toMediaUrl,
}
