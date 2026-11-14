import { execFileSync } from 'node:child_process'
import path from 'node:path'

const volumeQuery = 'Get-Volume | Select-Object DriveLetter, FileSystemLabel, UniqueId, SerialNumber, DriveType, HealthStatus | ConvertTo-Json -Compress'

export function getMountedVolumes() {
  if (process.platform !== 'win32') return []

  try {
    const output = execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      volumeQuery,
    ], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    }).trim()

    if (!output) return []
    const parsed = JSON.parse(output)
    return (Array.isArray(parsed) ? parsed : [parsed])
      .map(normalizeVolume)
      .filter((volume) => volume.volumeId || volume.driveLetter)
  } catch {
    return []
  }
}

export function getVolumeInfoForPath(sourcePath) {
  const driveLetter = getDriveLetter(sourcePath)
  if (!driveLetter) return null

  const volume = getMountedVolumes().find((item) => item.driveLetter === driveLetter)
  if (!volume) return null

  return {
    ...volume,
    driveLetter,
    online: true,
    rootRelativePath: getRootRelativePath(sourcePath),
    removable: volume.driveType === 'Removable' || driveLetter !== 'C',
  }
}

export function getRootRelativePath(sourcePath) {
  const driveLetter = getDriveLetter(sourcePath)
  if (!driveLetter) return ''
  return path.win32.relative(`${driveLetter}:\\`, sourcePath) || ''
}

export function findMountedSource(source) {
  if (!source.volume_id || !source.root_relative_path) return null

  const volume = getMountedVolumes().find((item) => item.volumeId === source.volume_id)
  if (!volume?.driveLetter) return null

  return {
    ...volume,
    rootPath: path.win32.join(`${volume.driveLetter}:\\`, source.root_relative_path),
    removable: volume.driveType === 'Removable' || volume.driveLetter !== 'C',
  }
}

function normalizeVolume(volume) {
  const driveLetter = typeof volume.DriveLetter === 'string'
    ? volume.DriveLetter.trim().toUpperCase()
    : ''
  const volumeId = String(volume.UniqueId || volume.SerialNumber || '').trim()
  return {
    driveLetter,
    volumeId,
    volumeLabel: String(volume.FileSystemLabel || '').trim() || null,
    driveType: String(volume.DriveType || '').trim(),
    healthStatus: String(volume.HealthStatus || '').trim(),
  }
}

function getDriveLetter(sourcePath) {
  const match = /^(?<drive>[a-z]):(?:\\|$)/i.exec(sourcePath)
  return match?.groups?.drive?.toUpperCase() || ''
}
