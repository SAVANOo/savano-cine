import { randomUUID } from 'node:crypto'

const PARTY_ROOMS = new Map()
const REMOTE_SESSIONS = new Map()

function generateRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

function broadcastSse(clients, eventName, payload) {
  const frame = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`
  for (const res of clients) {
    try {
      res.write(frame)
    } catch {
      clients.delete(res)
    }
  }
}

/** Handles /api/party/* (Watch Party sync + chat) and /api/remote/* (Phone remote control). */
export async function handleRealtimeRoutes({ request, response, requestUrl, readBody, send }) {
  // Watch Party endpoints
  if (requestUrl.pathname === '/api/party/create' && request.method === 'POST') {
    const body = await readBody(request).catch(() => null)
    const code = generateRoomCode()
    const room = {
      code,
      title: String(body?.title || 'Sessão Savano Cine'),
      mediaUrl: String(body?.mediaUrl || ''),
      positionSec: Number(body?.positionSec || 0),
      paused: Boolean(body?.paused),
      updatedAt: Date.now(),
      messages: [],
      clients: new Set(),
    }
    PARTY_ROOMS.set(code, room)
    send(response, 200, { code, title: room.title, positionSec: room.positionSec, paused: room.paused })
    return true
  }

  const partyEventsMatch = requestUrl.pathname.match(/^\/api\/party\/([A-Za-z0-9_-]+)\/events$/)
  if (partyEventsMatch && request.method === 'GET') {
    const code = partyEventsMatch[1].toUpperCase()
    const room = PARTY_ROOMS.get(code)
    if (!room) {
      send(response, 404, { error: 'Sala Watch Party não encontrada.' })
      return true
    }
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    })
    room.clients.add(response)
    response.write(
      `event: state\ndata: ${JSON.stringify({
        code: room.code,
        title: room.title,
        positionSec: room.positionSec,
        paused: room.paused,
        messages: room.messages,
      })}\n\n`,
    )
    request.on('close', () => {
      room.clients.delete(response)
    })
    return true
  }

  const partySyncMatch = requestUrl.pathname.match(/^\/api\/party\/([A-Za-z0-9_-]+)\/sync$/)
  if (partySyncMatch && request.method === 'POST') {
    const code = partySyncMatch[1].toUpperCase()
    const room = PARTY_ROOMS.get(code)
    if (!room) {
      send(response, 404, { error: 'Sala Watch Party não encontrada.' })
      return true
    }
    const body = await readBody(request).catch(() => null)
    if (typeof body?.positionSec === 'number') room.positionSec = body.positionSec
    if (typeof body?.paused === 'boolean') room.paused = body.paused
    room.updatedAt = Date.now()
    broadcastSse(room.clients, 'sync', {
      positionSec: room.positionSec,
      paused: room.paused,
      sender: String(body?.sender || 'Participante'),
      at: room.updatedAt,
    })
    send(response, 200, { ok: true })
    return true
  }

  const partyChatMatch = requestUrl.pathname.match(/^\/api\/party\/([A-Za-z0-9_-]+)\/chat$/)
  if (partyChatMatch && request.method === 'POST') {
    const code = partyChatMatch[1].toUpperCase()
    const room = PARTY_ROOMS.get(code)
    if (!room) {
      send(response, 404, { error: 'Sala Watch Party não encontrada.' })
      return true
    }
    const body = await readBody(request).catch(() => null)
    const text = String(body?.text || '').trim().slice(0, 240)
    if (!text) {
      send(response, 400, { error: 'Mensagem vazia.' })
      return true
    }
    const msg = {
      id: randomUUID().slice(0, 8),
      sender: String(body?.sender || 'Anônimo').slice(0, 32),
      text,
      at: Date.now(),
    }
    room.messages = [...room.messages, msg].slice(-30)
    broadcastSse(room.clients, 'chat', msg)
    send(response, 200, msg)
    return true
  }

  const partyGetMatch = requestUrl.pathname.match(/^\/api\/party\/([A-Za-z0-9_-]+)$/)
  if (partyGetMatch && request.method === 'GET') {
    const code = partyGetMatch[1].toUpperCase()
    const room = PARTY_ROOMS.get(code)
    if (!room) {
      send(response, 404, { error: 'Sala não encontrada.' })
      return true
    }
    send(response, 200, {
      code: room.code,
      title: room.title,
      mediaUrl: room.mediaUrl,
      positionSec: room.positionSec,
      paused: room.paused,
      messages: room.messages,
    })
    return true
  }

  // Phone Remote Control endpoints
  const ensureRemoteSession = (id) => {
    const key = id.toUpperCase()
    if (!REMOTE_SESSIONS.has(key)) {
      REMOTE_SESSIONS.set(key, {
        session: key,
        title: 'Savano Cine',
        paused: false,
        currentTime: 0,
        duration: 0,
        clients: new Set(),
      })
    }
    return REMOTE_SESSIONS.get(key)
  }

  const remoteEventsMatch = requestUrl.pathname.match(/^\/api\/remote\/([A-Za-z0-9_-]+)\/events$/)
  if (remoteEventsMatch && request.method === 'GET') {
    const session = ensureRemoteSession(remoteEventsMatch[1])
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    })
    session.clients.add(response)
    response.write(`event: connected\ndata: ${JSON.stringify({ session: session.session })}\n\n`)
    request.on('close', () => {
      session.clients.delete(response)
    })
    return true
  }

  const remoteCmdMatch = requestUrl.pathname.match(/^\/api\/remote\/([A-Za-z0-9_-]+)\/command$/)
  if (remoteCmdMatch && request.method === 'POST') {
    const session = ensureRemoteSession(remoteCmdMatch[1])
    const body = await readBody(request).catch(() => null)
    const cmd = {
      action: String(body?.action || ''),
      value: body?.value ?? null,
      at: Date.now(),
    }
    broadcastSse(session.clients, 'command', cmd)
    send(response, 200, { ok: true })
    return true
  }

  const remoteStateMatch = requestUrl.pathname.match(/^\/api\/remote\/([A-Za-z0-9_-]+)\/state$/)
  if (remoteStateMatch) {
    const session = ensureRemoteSession(remoteStateMatch[1])
    if (request.method === 'POST') {
      const body = await readBody(request).catch(() => null)
      if (typeof body?.title === 'string') session.title = body.title
      if (typeof body?.paused === 'boolean') session.paused = body.paused
      if (typeof body?.currentTime === 'number') session.currentTime = body.currentTime
      if (typeof body?.duration === 'number') session.duration = body.duration
      send(response, 200, { ok: true })
      return true
    }
    if (request.method === 'GET') {
      send(response, 200, {
        session: session.session,
        title: session.title,
        paused: session.paused,
        currentTime: session.currentTime,
        duration: session.duration,
      })
      return true
    }
  }

  return false
}
