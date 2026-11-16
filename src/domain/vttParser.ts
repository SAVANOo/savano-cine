export type VttCue = {
  start: number
  end: number
  text: string
}

function parseVttTimestamp(raw: string): number {
  const clean = raw.trim().replace(',', '.')
  const parts = clean.split(':')
  if (parts.length === 3) {
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2])
  }
  if (parts.length === 2) {
    return Number(parts[0]) * 60 + Number(parts[1])
  }
  return Number.NaN
}

/** Parses WebVTT (or SRT-style) subtitle text into timed cue objects for dual-subtitle rendering. */
export function parseWebVtt(vttText: string): VttCue[] {
  const cues: VttCue[] = []
  const blocks = vttText.replace(/\r\n?/g, '\n').split(/\n{2,}/)
  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trimEnd())
      .filter(Boolean)
    if (lines.length === 0) continue
    const timingIndex = lines.findIndex((line) => line.includes('-->'))
    if (timingIndex < 0) continue
    const [startRaw, endRaw] = lines[timingIndex].split('-->')
    const start = parseVttTimestamp(startRaw || '')
    const end = parseVttTimestamp((endRaw || '').trim().split(/\s+/)[0] || '')
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    const text = lines
      .slice(timingIndex + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim()
    if (text) cues.push({ start, end, text })
  }
  return cues
}

/** Returns all active cue lines at a given playback timestamp in seconds. */
export function findActiveCueText(cues: VttCue[], timeSec: number): string {
  if (!cues.length || !Number.isFinite(timeSec)) return ''
  return cues
    .filter((cue) => timeSec >= cue.start && timeSec <= cue.end)
    .map((cue) => cue.text)
    .join('\n')
}
