/**
 * Publish the GitHub release for this package.
 *
 * Reads the token from GH_TOKEN (never from the command line) and attaches the
 * packed tarball so the release is directly installable.
 *
 * Usage: GH_TOKEN=... node scripts/release.mjs <tag> <tarball> <notesFile>
 */
import { readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'

const [tag, tarball, notesFile] = process.argv.slice(2)
const token = process.env.GH_TOKEN
const OWNER = 'wnduddld0513'
const REPO = 'dsh-korean-lang'

if (!token) throw new Error('GH_TOKEN is required')
if (!tag || !tarball || !notesFile) throw new Error('usage: release.mjs <tag> <tarball> <notesFile>')

const api = `https://api.github.com/repos/${OWNER}/${REPO}`
const headers = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'dsh-korean-lang-release',
}

const notes = readFileSync(notesFile, 'utf8')

const created = await fetch(`${api}/releases`, {
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify({
    tag_name: tag,
    name: tag,
    body: notes,
    draft: false,
    prerelease: false,
  }),
})
if (!created.ok) {
  console.error(`release create failed: ${created.status} ${await created.text()}`)
  process.exit(1)
}
const release = await created.json()
console.log(`release: ${release.html_url}`)

// --- attach the packed tarball ---------------------------------------------
const name = basename(tarball)
const body = readFileSync(tarball)
const upload = await fetch(
  `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
  {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/gzip', 'content-length': String(body.length) },
    body,
  },
)
if (!upload.ok) {
  console.error(`asset upload failed: ${upload.status} ${await upload.text()}`)
  process.exit(1)
}
const asset = await upload.json()
console.log(`asset: ${asset.name} (${(statSync(tarball).size / 1024).toFixed(1)} KiB)`)
console.log(`download: ${asset.browser_download_url}`)
