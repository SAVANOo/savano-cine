import { randomUUID } from 'node:crypto'

export function ensureSocialTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS social_reviews (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      content_key TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'movie',
      title TEXT NOT NULL,
      poster TEXT,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      comment TEXT NOT NULL DEFAULT '',
      recommended_to_profile_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(profile_id, content_key)
    )
  `)
}

/** Handles /api/social/* endpoints for community reviews, recommendations and profile stats. */
export async function handleSocialRoutes({ request, response, requestUrl, database, readBody, send }) {
  ensureSocialTable(database)

  if (requestUrl.pathname === '/api/social/feed' && request.method === 'GET') {
    const activeProfileId = requestUrl.searchParams.get('profileId') || 'profile-savio'
    const profiles = database.prepare('SELECT id, name, avatar_key AS avatarKey FROM profiles').all()
    const profileMap = new Map(profiles.map((p) => [p.id, p]))

    const reviewRows = database
      .prepare(`
        SELECT r.id, r.profile_id AS profileId, r.content_key AS contentKey, r.content_type AS contentType,
               r.title, r.poster, r.rating, r.comment, r.recommended_to_profile_id AS recommendedToProfileId,
               r.updated_at AS updatedAt
        FROM social_reviews r
        ORDER BY r.updated_at DESC
        LIMIT 80
      `)
      .all()

    const seenKeys = new Set(reviewRows.map((r) => `${r.profileId}::${r.contentKey}`))

    const legacyRatings = database
      .prepare(`
        SELECT rt.profile_id AS profileId,
               COALESCE(rt.media_item_id, rt.show_id) AS contentKey,
               CASE WHEN rt.show_id IS NOT NULL THEN 'series' ELSE 'movie' END AS contentType,
               rt.score AS rawRating,
               COALESCE(rt.review, '') AS comment,
               rt.updated_at AS updatedAt,
               COALESCE(m.title, sh.title, rt.media_item_id, rt.show_id) AS title,
               COALESCE(am.local_path, ash.local_path, am.remote_url, ash.remote_url) AS poster
        FROM ratings rt
        LEFT JOIN media_items m ON rt.media_item_id IS NOT NULL AND m.id = rt.media_item_id
        LEFT JOIN shows sh ON rt.show_id IS NOT NULL AND sh.id = rt.show_id
        LEFT JOIN artwork am ON am.movie_id = m.id AND am.artwork_type = 'poster'
        LEFT JOIN artwork ash ON ash.show_id = sh.id AND ash.artwork_type = 'poster'
        WHERE COALESCE(rt.media_item_id, rt.show_id) IS NOT NULL
        ORDER BY rt.updated_at DESC
        LIMIT 50
      `)
      .all()

    const normalizedLegacy = legacyRatings
      .filter((r) => !seenKeys.has(`${r.profileId}::${r.contentKey}`))
      .map((r) => ({
        id: `legacy-${r.profileId}-${r.contentKey}`,
        profileId: r.profileId,
        contentKey: r.contentKey,
        contentType: r.contentType,
        title: r.title,
        poster: r.poster ? (String(r.poster).startsWith('http') ? r.poster : `/api/artwork/file?path=${encodeURIComponent(r.poster)}`) : null,
        rating: Math.max(1, Math.min(5, Math.round(Number(r.rawRating || 6) / 2))),
        comment: r.comment || '',
        recommendedToProfileId: null,
        updatedAt: r.updatedAt,
      }))

    const allReviews = [...reviewRows, ...normalizedLegacy].map((r) => {
      const author = profileMap.get(r.profileId)
      const recTarget = r.recommendedToProfileId ? profileMap.get(r.recommendedToProfileId) : null
      return {
        ...r,
        authorName: author?.name || 'Usuário',
        authorAvatarKey: author?.avatarKey || 'amber',
        recommendedToName: recTarget?.name || null,
      }
    })

    const recommendedForMe = allReviews.filter((r) => r.recommendedToProfileId === activeProfileId)

    const localWatched =
      database
        .prepare(`SELECT COUNT(*) AS cnt FROM watch_progress WHERE profile_id = ? AND watched = 1`)
        .get(activeProfileId)?.cnt || 0
    const onlineWatched =
      database
        .prepare(`SELECT COUNT(*) AS cnt FROM stremio_progress WHERE profile_id = ? AND position_sec > 60`)
        .get(activeProfileId)?.cnt || 0
    const myReviews = allReviews.filter((r) => r.profileId === activeProfileId)
    const avgRating =
      myReviews.length > 0
        ? Number((myReviews.reduce((acc, r) => acc + Number(r.rating || 0), 0) / myReviews.length).toFixed(1))
        : 0

    send(response, 200, {
      reviews: allReviews,
      recommendedForMe,
      stats: {
        watchedCount: Number(localWatched) + Number(onlineWatched),
        reviewCount: myReviews.length,
        avgRating,
      },
    })
    return true
  }

  if (requestUrl.pathname === '/api/social/reviews' && request.method === 'POST') {
    const body = await readBody(request).catch(() => null)
    const profileId = String(body?.profileId || '').trim()
    const contentKey = String(body?.contentKey || '').trim()
    const title = String(body?.title || '').trim()
    const rating = Number(body?.rating || 0)
    if (!profileId || !contentKey || !title || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      send(response, 400, { error: 'Informe perfil, título e nota de 1 a 5 estrelas.' })
      return true
    }
    const contentType = body?.contentType === 'series' ? 'series' : 'movie'
    const poster = typeof body?.poster === 'string' ? body.poster : null
    const comment = String(body?.comment || '').trim().slice(0, 600)
    const recommendedTo =
      typeof body?.recommendedToProfileId === 'string' && body.recommendedToProfileId.trim()
        ? body.recommendedToProfileId.trim()
        : null

    const id = `rev-${randomUUID().slice(0, 12)}`
    database
      .prepare(`
        INSERT INTO social_reviews (id, profile_id, content_key, content_type, title, poster, rating, comment, recommended_to_profile_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(profile_id, content_key) DO UPDATE SET
          title = excluded.title,
          poster = COALESCE(excluded.poster, social_reviews.poster),
          rating = excluded.rating,
          comment = excluded.comment,
          recommended_to_profile_id = excluded.recommended_to_profile_id,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(id, profileId, contentKey, contentType, title, poster, rating, comment, recommendedTo)

    send(response, 200, { ok: true })
    return true
  }

  const delMatch = requestUrl.pathname.match(/^\/api\/social\/reviews\/([^/]+)$/)
  if (delMatch && request.method === 'DELETE') {
    const id = decodeURIComponent(delMatch[1])
    database.prepare('DELETE FROM social_reviews WHERE id = ?').run(id)
    send(response, 200, { ok: true })
    return true
  }

  return false
}
