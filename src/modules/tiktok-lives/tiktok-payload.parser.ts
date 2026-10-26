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
      (room.owner ? room.id : undefined);
    if (
      username &&
      (typeof roomId !== 'number' || Number.isSafeInteger(roomId)) &&
      /^\d{5,30}$/.test(String(roomId ?? '')) &&
      (room.status === undefined || Number(room.status) === 2)
    ) {
      const tags = (room.hashtags ?? room.tags ?? []).slice?.(0, 30);
      result.set(username, {
        username,
        roomId: String(roomId),
        title: String(room.title ?? '').slice(0, 500),
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
