import {
  imageUrl,
  LiveCandidate,
  normalizeUsername,
  viewerCount,
} from './tiktok-lives.types';

function photo(value: any): string | undefined {
  return imageUrl(
    typeof value === 'string'
      ? value
      : (value?.url_list?.[0] ?? value?.urlList?.[0]),
  );
}

const QUALITIES = ['sd', 'ld', 'hd', 'origin'];
const FLV_KEYS = ['SD1', 'SD2', 'HD1', 'FULL_HD1'];

/**
 * Low-bandwidth pull URLs. `stream_data` (JSON string in `streamData` or `live_core_sdk_data`) names
 * every quality, so it's read first; `stream_url` often only exposes HD on web rooms.
 */
function streams(room: any): { hls?: string; flv?: string } {
  const api = room.stream_url ?? room.streamUrl;
  let hls: string | undefined;
  let flv: string | undefined;
  const raw =
    room.streamData?.pull_data?.stream_data ??
    api?.live_core_sdk_data?.pull_data?.stream_data;
  if (typeof raw === 'string' && raw.length <= 2e5) {
    try {
      const qualities = JSON.parse(raw)?.data ?? {};
      const main = QUALITIES.map((q) => qualities[q]?.main).find(
        (m) => m?.hls || m?.flv,
      );
      hls = main?.hls || undefined;
      flv = main?.flv || undefined;
    } catch {
      /* malformed stream data */
    }
  }
  hls ??= api?.hls_pull_url;
  flv ??= FLV_KEYS.map((k) => api?.flv_pull_url?.[k]).find(Boolean);
  return { hls: imageUrl(hls), flv: imageUrl(flv) };
}

/** Parse only room-shaped objects; never infer a live from an ordinary user profile. */
export function parseRooms(payload: unknown): LiveCandidate[] {
  const result = new Map<string, LiveCandidate>();
  let visited = 0;
  function walk(value: any, depth: number): void {
    if (!value || typeof value !== 'object' || depth > 14 || ++visited > 10000)
      return;
    if (Array.isArray(value)) {
      value.slice(0, 200).forEach((item) => walk(item, depth + 1));
      return;
    }
    const room = value.room ?? value.room_info ?? value.liveRoom ?? value;
    const owner = room.owner ?? value.user ?? room.ownerInfo;
    const username = normalizeUsername(
      owner?.display_id ?? owner?.uniqueId ?? owner?.unique_id,
    );
    const roomId =
      room.id_str ??
      room.room_id ??
      room.roomId ??
      // TikTok's HTML/API-live response keeps the ID on the sibling user,
      // while liveRoom contains status, title and streams (without roomId).
      (value.liveRoom ? value.user?.roomId : undefined) ??
      (room.owner ? room.id : undefined);
    if (
      username &&
      (typeof roomId !== 'number' || Number.isSafeInteger(roomId)) &&
      /^\d{5,30}$/.test(String(roomId ?? '')) &&
      (room.status === undefined || Number(room.status) === 2)
    ) {
      const tags = (room.hashtags ?? room.tags ?? []).slice?.(0, 30);
      const { hls, flv } = streams(room);
      result.set(username, {
        // Only set when present, so merging a probe without streams keeps the discovered ones.
        ...(hls ? { streamHlsUrl: hls } : {}),
        ...(flv ? { streamFlvUrl: flv } : {}),
        username,
        roomId: String(roomId),
        title: String(room.title ?? '').slice(0, 500),
        nickname: typeof owner.nickname === 'string' ? owner.nickname.slice(0, 200) : undefined,
        bio: typeof (owner.bio_description ?? owner.signature) === 'string'
          ? (owner.bio_description ?? owner.signature).slice(0, 1000)
          : undefined,
        viewerCount: viewerCount(
          room.user_count ??
            room.userCount ??
            room.stats?.user_count ??
            room.liveRoomStats?.userCount,
        ),
        avatarUrl: photo(
          owner.avatar_thumb ?? owner.avatarThumb ?? owner.avatar,
        ),
        coverImageUrl: photo(room.cover ?? room.cover_image ?? room.coverUrl),
        tags: Array.isArray(tags)
          ? tags
              .map((t) =>
                typeof t === 'string' ? t : (t?.name ?? t?.title ?? ''),
              )
              .filter(Boolean)
              .map((t) => t.slice(0, 80))
          : [],
        countryCode:
          typeof (room.owner_country ?? owner.region) === 'string'
            ? String(room.owner_country ?? owner.region).toUpperCase()
            : undefined,
      });
    }
    Object.values(value).forEach((child) => walk(child, depth + 1));
  }
  walk(payload, 0);
  return [...result.values()];
}
